package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.model.TransferRequest;
import com.myplatform.demo.model.TransferRouteOption;
import com.myplatform.demo.util.RecipientCountries;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class TransferRouteServiceTest {

    private static final String FR_IBAN = "FR6410096000403534259742Y90";
    private static final List<TransferRouteOption> ROUTES = List.of(
            new TransferRouteOption("regular", 1L, null, false, List.of()),
            new TransferRouteOption("instant", 100L, 10_000_000L, true, List.of()));

    @Test
    void theRoutesAreTheOnesAdyenCalculatesForTheBankAccountCheapestFirst() throws Exception {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer adyen = MockRestServiceServer.bindTo(restTemplate).build();
        TransferRouteService service = new TransferRouteService(restTemplate, new ObjectMapper(), "key", "BP1");
        adyen.expect(requestTo("https://balanceplatform-api-test.adyen.com/bcl/v2/transferRoutes/calculate"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json("""
                        {"balancePlatform": "BP1", "balanceAccountId": "BA1", "category": "bank", "currency": "EUR",
                         "counterparty": {"bankAccount": {"accountIdentification": {"type": "iban", "iban": "%s"}}},
                         "priorities": ["regular", "fast", "instant"]}
                        """.formatted(FR_IBAN)))
                .andRespond(withSuccess("""
                        {"transferRoutes": [
                          {"priority": "instant", "requirements": [
                            {"type": "amountMinMaxRequirement", "min": 1, "max": 10000000},
                            {"type": "aRequirementAdyenAddedLater", "description": "Something new"}]},
                          {"priority": "regular", "requirements": []}
                        ]}
                        """, MediaType.APPLICATION_JSON));
        TransferRequest beneficiary = new TransferRequest();
        beneficiary.setIban(FR_IBAN);

        List<TransferRouteOption> routes = service.calculateRoutes("BA1", RecipientCountries.require("EUR", "FR"), beneficiary);

        adyen.verify();
        assertThat(routes).extracting(TransferRouteOption::getPriority).containsExactly("regular", "instant");
        assertThat(routes.get(1).getMaxAmount()).isEqualTo(10_000_000L);
        assertThat(routes.get(1).getRequirements()).containsExactly("Something new");
    }

    @Test
    void aSpeedWithoutRouteToTheBeneficiaryIsNotAvailable() {
        assertThat(TransferRouteService.unavailableReason(ROUTES, "fast", 12_000, "EUR"))
                .isEqualTo("Fast transfers are not available for this beneficiary");
        assertThat(TransferRouteService.unavailableReason(List.of(), "regular", 12_000, "EUR"))
                .isEqualTo("Regular transfers are not available for this beneficiary");
    }

    @Test
    void theAmountMustFitTheLimitsOfTheRoute() {
        assertThat(TransferRouteService.unavailableReason(ROUTES, "regular", 15_000_000_000L, "EUR")).isNull();
        assertThat(TransferRouteService.unavailableReason(ROUTES, "instant", 12_000, "EUR")).isNull();
        assertThat(TransferRouteService.unavailableReason(ROUTES, "instant", 50, "EUR"))
                .isEqualTo("The minimum amount for instant transfers to this beneficiary is 1.00 EUR");
        assertThat(TransferRouteService.unavailableReason(ROUTES, "instant", 10_000_100, "EUR"))
                .isEqualTo("The maximum amount for instant transfers to this beneficiary is 100000.00 EUR");
        assertThat(TransferRouteService.unavailableReason(ROUTES, "instant", 12_050, "EUR"))
                .isEqualTo("Instant transfers to this beneficiary only accept whole amounts");
    }
}
