package com.myplatform.demo.util;

import com.adyen.model.clouddevice.CloudDeviceApiResponse;
import com.adyen.model.tapi.CardData;
import com.adyen.model.tapi.ErrorCondition;
import com.adyen.model.tapi.EventNotification;
import com.adyen.model.tapi.POIData;
import com.adyen.model.tapi.PaymentInstrumentData;
import com.adyen.model.tapi.PaymentResponse;
import com.adyen.model.tapi.PaymentResult;
import com.adyen.model.tapi.Response;
import com.adyen.model.tapi.Result;
import com.adyen.model.tapi.ReversalResponse;
import com.adyen.model.tapi.SaleToPOIRequest;
import com.adyen.model.tapi.SaleToPOIResponse;
import com.adyen.model.tapi.TransactionIDType;
import com.adyen.service.exception.ApiException;
import org.junit.jupiter.api.Test;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

class TerminalResponsesTest {

    private static final OffsetDateTime AT = OffsetDateTime.parse("2026-11-16T10:15:30Z");
    private static final String TRANSACTION = "oLkO001763288130000.QJWQ3RBV6QKJ8N82";

    @Test
    void anApprovedPaymentTellsThePaymentAndTheCard() {
        TerminalOutcome outcome = TerminalResponses.payment(payment(new Response().result(Result.SUCCESS),
                new CardData().paymentBrand("VISA").maskedPan("411111******1111")));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.APPROVED);
        assertThat(outcome.message()).isNull();
        assertThat(outcome.pspReference()).isEqualTo("QJWQ3RBV6QKJ8N82");
        assertThat(outcome.transactionId()).isEqualTo(TRANSACTION);
        assertThat(outcome.transactionAt()).isEqualTo(AT.toInstant());
        assertThat(outcome.cardBrand()).isEqualTo("visa");
        assertThat(outcome.maskedPan()).isEqualTo("411111******1111");
    }

    @Test
    void aPaymentWithoutCardDataTakesTheCardFromTheAdditionalResponse() {
        TerminalOutcome outcome = TerminalResponses.payment(payment(new Response().result(Result.SUCCESS)
                .additionalResponse("paymentMethod=mc&cardSummary=4444&posAuthAmountValue=1200"), null));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.APPROVED);
        assertThat(outcome.cardBrand()).isEqualTo("mc");
        assertThat(outcome.maskedPan()).isEqualTo("4444");
    }

    @Test
    void aRefusedCardIsDeclinedWithTheReasonOfTheEncodedAdditionalResponse() {
        String additional = Base64.getEncoder().encodeToString(
                "{\"additionalData\":{\"refusalReason\":\"Not enough balance\"},\"message\":\"Refused\"}"
                        .getBytes(StandardCharsets.UTF_8));

        TerminalOutcome outcome = TerminalResponses.payment(payment(new Response().result(Result.FAILURE)
                .errorCondition(ErrorCondition.REFUSAL).additionalResponse(additional), null));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.DECLINED);
        assertThat(outcome.reason()).isEqualTo("Not enough balance");
        assertThat(outcome.message()).isEqualTo("Declined: Not enough balance.");
        assertThat(outcome.pspReference()).isEqualTo("QJWQ3RBV6QKJ8N82");
    }

    @Test
    void aPaymentCancelledAtTheTerminalOrAbortedIsCancelled() {
        TerminalOutcome atTerminal = TerminalResponses.payment(payment(new Response().result(Result.FAILURE)
                .errorCondition(ErrorCondition.CANCEL), null));
        TerminalOutcome aborted = TerminalResponses.payment(payment(new Response().result(Result.FAILURE)
                .errorCondition(ErrorCondition.ABORTED), null));

        assertThat(atTerminal.result()).isEqualTo(TerminalOutcome.Result.CANCELLED);
        assertThat(atTerminal.message()).isEqualTo("The payment was cancelled at the terminal.");
        assertThat(aborted.result()).isEqualTo(TerminalOutcome.Result.CANCELLED);
        assertThat(aborted.message()).isEqualTo("The payment was cancelled.");
    }

    @Test
    void aBusyTerminalIsAnErrorSoNothingWasCharged() {
        TerminalOutcome outcome = TerminalResponses.payment(payment(new Response().result(Result.FAILURE)
                .errorCondition(ErrorCondition.BUSY), null));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.ERROR);
        assertThat(outcome.message()).isEqualTo("The terminal is busy with another transaction. Try again once it's done.");
    }

    @Test
    void anAnswerWithoutResultOrApprovingPartOfTheAmountIsUnknown() {
        TerminalOutcome noResult = TerminalResponses.payment(payment(new Response(), null));
        TerminalOutcome partial = TerminalResponses.payment(payment(new Response().result(Result.PARTIAL), null));

        assertThat(noResult.result()).isEqualTo(TerminalOutcome.Result.UNKNOWN);
        assertThat(partial.result()).isEqualTo(TerminalOutcome.Result.UNKNOWN);
        assertThat(partial.message()).isEqualTo(
                "The terminal approved only part of the amount. Check the payment before trying again.");
    }

    @Test
    void theCloudWaitingInVainForTheTerminalIsUnknown() {
        TerminalOutcome outcome = TerminalResponses.payment(event("message=Did+not+receive+a+response+from+the+POI."));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.UNKNOWN);
        assertThat(outcome.message()).isEqualTo("The terminal didn't answer in time. Check its screen before trying again.");
    }

    @Test
    void aTerminalTheCloudCantReachIsAnError() {
        TerminalOutcome outcome = TerminalResponses.payment(event("message=Terminal+is+not+connected"));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.ERROR);
        assertThat(outcome.message()).isEqualTo("The terminal couldn't be reached: Terminal is not connected.");
    }

    @Test
    void aRequestAdyenRejectedIsAnErrorButAServerErrorIsUnknown() {
        ApiException rejected = new ApiException("Forbidden", 403);
        rejected.setResponseBody("{\"status\":403,\"errorCode\":\"010\",\"message\":\"Not allowed\",\"errorType\":\"security\"}");

        TerminalOutcome error = TerminalResponses.failure(rejected);
        TerminalOutcome unknown = TerminalResponses.failure(new ApiException("Bad gateway", 502));

        assertThat(error.result()).isEqualTo(TerminalOutcome.Result.ERROR);
        assertThat(error.message()).isEqualTo("The terminal couldn't be reached: Not allowed.");
        assertThat(unknown.result()).isEqualTo(TerminalOutcome.Result.UNKNOWN);
    }

    @Test
    void aLostAnswerIsUnknownButAnUnreachablePlatformIsAnError() {
        assertThat(TerminalResponses.lost(new SocketTimeoutException("Read timed out")).result())
                .isEqualTo(TerminalOutcome.Result.UNKNOWN);
        assertThat(TerminalResponses.lost(new ConnectException("Connection refused")).result())
                .isEqualTo(TerminalOutcome.Result.ERROR);
    }

    @Test
    void anAcceptedRefundTellsTheRefund() {
        TerminalOutcome outcome = TerminalResponses.reversal(reversal(new Response().result(Result.SUCCESS)));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.APPROVED);
        assertThat(outcome.pspReference()).isEqualTo("R4C6YVQK7PKJ8N82");
        assertThat(outcome.cardBrand()).isNull();
    }

    @Test
    void aRefusedRefundIsDeclined() {
        TerminalOutcome outcome = TerminalResponses.reversal(reversal(new Response().result(Result.FAILURE)
                .errorCondition(ErrorCondition.REFUSAL).additionalResponse("message=Refund+not+allowed")));

        assertThat(outcome.result()).isEqualTo(TerminalOutcome.Result.DECLINED);
        assertThat(outcome.message()).isEqualTo("The refund was refused: Refund not allowed.");
    }

    @Test
    void anAdditionalResponseInPlainTextIsItsMessage() {
        assertThat(TerminalResponses.additionalResponse("Card")).containsEntry("message", "Card");
        assertThat(TerminalResponses.additionalResponse("  ")).isEmpty();
    }

    private static CloudDeviceApiResponse payment(Response result, CardData card) {
        PaymentResponse payment = new PaymentResponse()
                .response(result)
                .poiData(new POIData().poITransactionID(new TransactionIDType().transactionID(TRANSACTION).timeStamp(AT)));
        if (card != null) {
            payment.paymentResult(new PaymentResult().paymentInstrumentData(new PaymentInstrumentData().cardData(card)));
        }
        CloudDeviceApiResponse response = new CloudDeviceApiResponse();
        response.setSaleToPOIResponse(new SaleToPOIResponse().paymentResponse(payment));
        return response;
    }

    private static CloudDeviceApiResponse reversal(Response result) {
        CloudDeviceApiResponse response = new CloudDeviceApiResponse();
        response.setSaleToPOIResponse(new SaleToPOIResponse().reversalResponse(new ReversalResponse()
                .response(result)
                .poiData(new POIData().poITransactionID(new TransactionIDType()
                        .transactionID("oLkO001763288200000.R4C6YVQK7PKJ8N82").timeStamp(AT)))));
        return response;
    }

    private static CloudDeviceApiResponse event(String details) {
        CloudDeviceApiResponse response = new CloudDeviceApiResponse();
        response.setSaleToPOIRequest(new SaleToPOIRequest().eventNotification(new EventNotification().eventDetails(details)));
        return response;
    }
}
