package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.enums.Environment;
import com.myplatform.demo.model.PendingTransfer;
import com.myplatform.demo.repository.PendingTransferRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class TransferServiceTest {

    private static final String TRANSFERS = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";
    private static final String NOT_PENDING = """
            {"type": "https://docs.adyen.com/errors/validation", "status": 422, "errorCode": "30_081",
             "title": "The request is missing required fields or contains invalid data.", "detail": "Transfer is not pending"}
            """;

    private final RestTemplate restTemplate = new RestTemplate();
    private final MockRestServiceServer adyen = MockRestServiceServer.bindTo(restTemplate).build();
    private final PendingTransferRepository repository = mock(PendingTransferRepository.class);
    private final TransferService service = new TransferService(new Client("test", Environment.TEST), "test",
            restTemplate, repository);

    @BeforeEach
    void storedTransfers() {
        when(repository.findByAccountHolderId("AH1")).thenReturn(List.of(stored("EXPIRED"), stored("WAITING")));
    }

    @Test
    void aTransferWhoseApprovalExpiredLeavesTheBatchWithoutBeingCancelled() {
        adyen.expect(requestTo(TRANSFERS + "/cancel")).andExpect(method(HttpMethod.POST))
                .andExpect(content().json("{\"transferIds\": [\"EXPIRED\"]}"))
                .andRespond(withStatus(HttpStatus.UNPROCESSABLE_ENTITY).contentType(MediaType.APPLICATION_JSON).body(NOT_PENDING));
        adyen.expect(requestTo(TRANSFERS + "/EXPIRED")).andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(transfer("EXPIRED", "cancelled", "approvalExpired"), MediaType.APPLICATION_JSON));

        TransferService.CancelResult result = service.cancelTransfers("AH1", List.of("EXPIRED"));

        adyen.verify();
        assertThat(result.transferIds()).isEmpty();
        assertThat(result.noLongerPending()).extracting(transfer -> transfer.get("id")).containsExactly("EXPIRED");
        assertThat(result.noLongerPending()).extracting(transfer -> transfer.get("reason")).containsExactly("approvalExpired");
        verify(repository).deleteAllById(Set.of("EXPIRED"));
    }

    @Test
    void theOtherTransfersAreStillCancelled() {
        adyen.expect(requestTo(TRANSFERS + "/cancel"))
                .andExpect(content().json("{\"transferIds\": [\"EXPIRED\", \"WAITING\"]}"))
                .andRespond(withStatus(HttpStatus.UNPROCESSABLE_ENTITY).contentType(MediaType.APPLICATION_JSON).body(NOT_PENDING));
        adyen.expect(requestTo(TRANSFERS + "/EXPIRED"))
                .andRespond(withSuccess(transfer("EXPIRED", "cancelled", "approvalExpired"), MediaType.APPLICATION_JSON));
        adyen.expect(requestTo(TRANSFERS + "/WAITING"))
                .andRespond(withSuccess(transfer("WAITING", "received", "pending"), MediaType.APPLICATION_JSON));
        adyen.expect(requestTo(TRANSFERS + "/cancel"))
                .andExpect(content().json("{\"transferIds\": [\"WAITING\"]}"))
                .andRespond(withStatus(HttpStatus.ACCEPTED));

        TransferService.CancelResult result = service.cancelTransfers("AH1", List.of("EXPIRED", "WAITING"));

        adyen.verify();
        assertThat(result.transferIds()).containsExactly("WAITING");
        assertThat(result.noLongerPending()).extracting(transfer -> transfer.get("id")).containsExactly("EXPIRED");
        verify(repository).deleteAllById(Set.of("EXPIRED"));
        verify(repository).deleteAllById(List.of("WAITING"));
    }

    @Test
    void anyOtherRefusalIsReported() {
        adyen.expect(requestTo(TRANSFERS + "/cancel"))
                .andRespond(withStatus(HttpStatus.FORBIDDEN).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"status\": 403, \"errorCode\": \"00_403\", \"title\": \"Forbidden\"}"));

        assertThatThrownBy(() -> service.cancelTransfers("AH1", List.of("WAITING")))
                .isInstanceOf(HttpClientErrorException.class);
        adyen.verify();
        verify(repository, never()).deleteAllById(any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void thePendingListForgetsTheTransfersThatNoLongerWaitForTheirApproval() {
        adyen.expect(requestTo(TRANSFERS + "/EXPIRED"))
                .andRespond(withSuccess(transfer("EXPIRED", "cancelled", "approvalExpired"), MediaType.APPLICATION_JSON));
        adyen.expect(requestTo(TRANSFERS + "/WAITING"))
                .andRespond(withSuccess(transfer("WAITING", "received", "pending"), MediaType.APPLICATION_JSON));

        Map<String, Object> pending = service.getPendingTransfers("AH1");

        adyen.verify();
        assertThat((List<Map<String, Object>>) pending.get("transfers"))
                .extracting(transfer -> transfer.get("id")).containsExactly("WAITING");
        assertThat((List<Map<String, Object>>) pending.get("noLongerPending"))
                .extracting(transfer -> transfer.get("id")).containsExactly("EXPIRED");
        assertThat(pending.get("totalCount")).isEqualTo(1);
        verify(repository).deleteAllById(List.of("EXPIRED"));
    }

    private static PendingTransfer stored(String transferId) {
        PendingTransfer transfer = new PendingTransfer();
        transfer.setTransferId(transferId);
        transfer.setAccountHolderId("AH1");
        return transfer;
    }

    private static String transfer(String id, String status, String reason) {
        return """
                {"id": "%s", "status": "%s", "reason": "%s", "amount": {"value": 1000, "currency": "EUR"},
                 "counterparty": {"bankAccount": {"accountHolder": {"fullName": "Supplier Ltd"}}}}
                """.formatted(id, status, reason);
    }
}
