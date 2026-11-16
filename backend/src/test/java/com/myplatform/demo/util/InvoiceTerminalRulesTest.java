package com.myplatform.demo.util;

import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.InvoiceEvent;
import com.myplatform.demo.util.InvoiceTerminalRules.OriginalTransaction;
import com.myplatform.demo.util.InvoiceTerminalRules.RefundNotification;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static com.myplatform.demo.util.InvoiceTerminalRules.CANCEL_OR_REFUND;
import static com.myplatform.demo.util.InvoiceTerminalRules.REFUND;
import static com.myplatform.demo.util.InvoiceTerminalRules.REFUNDED_REVERSED;
import static com.myplatform.demo.util.InvoiceTerminalRules.REFUND_FAILED;
import static com.myplatform.demo.util.InvoiceTerminalRules.applyPayment;
import static com.myplatform.demo.util.InvoiceTerminalRules.applyRefund;
import static com.myplatform.demo.util.InvoiceTerminalRules.applyRefundNotification;
import static com.myplatform.demo.util.InvoiceTerminalRules.card;
import static com.myplatform.demo.util.InvoiceTerminalRules.lastFour;
import static com.myplatform.demo.util.InvoiceTerminalRules.notPayable;
import static com.myplatform.demo.util.InvoiceTerminalRules.notRefundable;
import static com.myplatform.demo.util.InvoiceTerminalRules.original;
import static com.myplatform.demo.util.InvoiceTerminalRules.refundableAmount;
import static com.myplatform.demo.util.InvoiceTerminalRules.refundedAmount;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class InvoiceTerminalRulesTest {

    private static final String TERMINAL = "S1F2-000158234567890";
    private static final Instant NOW = Instant.parse("2026-11-16T10:00:00Z");
    private static final Instant PAID_AT = Instant.parse("2026-11-16T09:58:00Z");

    // ---------- Payments ----------

    @Test
    void onlyASentInvoiceWithNoOtherPaymentInProgressCanBePaidAtATerminal() {
        Invoice invoice = invoice(Invoice.Status.SENT);
        assertThat(notPayable(invoice)).isNull();

        invoice.setPaymentLinkStatus("paymentPending");
        assertThat(notPayable(invoice)).isEqualTo("A payment of this invoice is in progress. Try again once it's settled.");

        invoice.setPaymentLinkStatus("active");
        invoice.setChargeStatus(Invoice.ChargeStatus.PENDING);
        assertThat(notPayable(invoice)).isEqualTo("The charge of INV-2026-0007 isn't confirmed yet. Try again once it is.");

        assertThat(notPayable(invoice(Invoice.Status.DRAFT))).isEqualTo("Send the invoice before collecting its payment.");
        assertThat(notPayable(invoice(Invoice.Status.PAID))).isEqualTo("This invoice is already paid.");
        assertThat(notPayable(invoice(Invoice.Status.VOID))).isEqualTo("A void invoice can't be paid.");
    }

    @Test
    void anApprovedPaymentMarksTheInvoicePaidAtTheTerminal() {
        Invoice invoice = invoice(Invoice.Status.SENT);

        assertThat(applyPayment(invoice, approved("PSP1"), TERMINAL, NOW)).isTrue();

        assertThat(invoice.getStatus()).isEqualTo(Invoice.Status.PAID);
        assertThat(invoice.getPaidAt()).isEqualTo(PAID_AT);
        assertThat(invoice.getPspReference()).isEqualTo("PSP1");
        assertThat(invoice.getPaymentMethod()).isEqualTo("visa");
        assertThat(invoice.getTerminalId()).isEqualTo(TERMINAL);
        assertThat(invoice.getTerminalTransactionId()).isEqualTo("tx.PSP1");
        assertThat(invoice.getTerminalTransactionAt()).isEqualTo(PAID_AT);
        assertThat(invoice.getEvents()).extracting(InvoiceEvent::getType, InvoiceEvent::getDetail).containsExactly(
                tuple(InvoiceEvent.Type.PAID, "Paid at terminal " + TERMINAL + " with Visa •••• 1111."));
    }

    @Test
    void theWebhookOfThePaymentArrivingFirstLeavesOnlyTheTerminalDetailsToAdd() {
        Invoice invoice = paid();
        invoice.setPaymentMethod("visa");
        invoice.addEvent(InvoiceEvent.Type.PAID, PAID_AT, "Paid by Visa.", "PSP1");

        assertThat(applyPayment(invoice, approved("PSP1"), TERMINAL, NOW)).isTrue();
        assertThat(applyPayment(invoice, approved("PSP1"), TERMINAL, NOW)).isFalse();

        assertThat(invoice.getStatus()).isEqualTo(Invoice.Status.PAID);
        assertThat(invoice.getTerminalId()).isEqualTo(TERMINAL);
        assertThat(invoice.getEvents()).extracting(InvoiceEvent::getDetail)
                .containsExactly("Paid at terminal " + TERMINAL + " with Visa •••• 1111.");
    }

    @Test
    void aPaymentApprovedAfterTheInvoiceWasPaidOtherwiseIsFlaggedForARefund() {
        Invoice invoice = paid();
        invoice.addEvent(InvoiceEvent.Type.PAID, PAID_AT, "Paid by Mastercard.", "PSP1");

        assertThat(applyPayment(invoice, approved("PSP2"), TERMINAL, NOW)).isTrue();
        assertThat(applyPayment(invoice, approved("PSP2"), TERMINAL, NOW)).isFalse();

        assertThat(invoice.getPspReference()).isEqualTo("PSP1");
        assertThat(invoice.getTerminalId()).isNull();
        assertThat(invoice.getEvents()).extracting(InvoiceEvent::getDetail).containsExactly("Paid by Mastercard.",
                "Also paid at terminal " + TERMINAL + " with Visa •••• 1111: the invoice was already paid, so refund this payment.");
    }

    @Test
    void aDeclinedPaymentIsRecordedOnce() {
        Invoice invoice = invoice(Invoice.Status.SENT);
        TerminalOutcome declined = new TerminalOutcome(TerminalOutcome.Result.DECLINED, "Declined: Not enough balance.",
                "Not enough balance", "PSP2", "tx.PSP2", PAID_AT, "mc", "5555");

        assertThat(applyPayment(invoice, declined, TERMINAL, NOW)).isTrue();
        assertThat(applyPayment(invoice, declined, TERMINAL, NOW)).isFalse();

        assertThat(invoice.getStatus()).isEqualTo(Invoice.Status.SENT);
        assertThat(invoice.getEvents()).extracting(InvoiceEvent::getType, InvoiceEvent::getDetail).containsExactly(
                tuple(InvoiceEvent.Type.PAYMENT_REFUSED,
                        "Payment at terminal " + TERMINAL + " with Mastercard •••• 5555 declined: Not enough balance."));
    }

    @Test
    void aCancelledFailedOrUnknownPaymentLeavesTheInvoiceAsItIs() {
        for (TerminalOutcome.Result result : List.of(TerminalOutcome.Result.CANCELLED, TerminalOutcome.Result.ERROR,
                TerminalOutcome.Result.UNKNOWN)) {
            Invoice invoice = invoice(Invoice.Status.SENT);

            assertThat(applyPayment(invoice, TerminalOutcome.of(result, "Not paid."), TERMINAL, NOW)).isFalse();

            assertThat(invoice.getStatus()).isEqualTo(Invoice.Status.SENT);
            assertThat(invoice.getEvents()).isEmpty();
        }
    }

    // ---------- Refunds at a terminal ----------

    @Test
    void onlyAConfirmedPaymentWithSomethingLeftToGiveBackCanBeRefunded() {
        Invoice invoice = paid();
        assertThat(notRefundable(invoice)).isNull();
        assertThat(notRefundable(invoice(Invoice.Status.SENT))).isEqualTo("Only a paid invoice can be refunded.");
        assertThat(notRefundable(invoice(Invoice.Status.PAID))).isEqualTo(
                "The payment of this invoice isn't confirmed yet, so it can't be refunded. Try again in a few minutes.");

        invoice.setRefundStatus(Invoice.RefundStatus.REQUESTED);
        assertThat(notRefundable(invoice)).isEqualTo("A refund of this invoice is already in progress.");

        invoice.setRefundStatus(Invoice.RefundStatus.REFUNDED);
        invoice.setRefundedAmount(1200L);
        assertThat(notRefundable(invoice)).isEqualTo("This invoice is already refunded.");
    }

    @Test
    void aRefundReferencesThePaymentOfTheTerminalElseItsPspReference() {
        Invoice online = paid();
        Invoice atTerminal = paid();
        atTerminal.setTerminalTransactionId("tx.PSP1");
        atTerminal.setTerminalTransactionAt(PAID_AT.minusSeconds(1));

        assertThat(original(online, NOW)).isEqualTo(new OriginalTransaction(".PSP1", PAID_AT, false));
        assertThat(original(atTerminal, NOW)).isEqualTo(new OriginalTransaction("tx.PSP1", PAID_AT.minusSeconds(1), true));
    }

    @Test
    void aRefundTheTerminalAcceptedIsRefundedOnceItsWebhookArrives() {
        Invoice invoice = paid();

        assertThat(applyRefund(invoice, accepted("REF1"), TERMINAL, NOW)).isTrue();

        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REQUESTED);
        assertThat(invoice.getRefundTerminalId()).isEqualTo(TERMINAL);
        assertThat(invoice.getRefundRequestedAt()).isEqualTo(NOW);

        RefundNotification webhook = refund(REFUND, true, "REF1", 1200L, NOW.plusSeconds(5));
        assertThat(applyRefundNotification(invoice, webhook)).isTrue();
        assertThat(applyRefundNotification(invoice, webhook)).isFalse();

        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REFUNDED);
        assertThat(invoice.getRefundedAmount()).isEqualTo(1200L);
        assertThat(invoice.getRefundedAt()).isEqualTo(NOW.plusSeconds(5));
        assertThat(invoice.getRefundTerminalId()).isEqualTo(TERMINAL);
        assertThat(invoice.getEvents()).extracting(InvoiceEvent::getType, InvoiceEvent::getDetail).containsExactly(
                tuple(InvoiceEvent.Type.REFUNDED, "Refunded 12.00 EUR to the customer."));
        assertThat(notRefundable(invoice)).isEqualTo("This invoice is already refunded.");
    }

    @Test
    void theAnswerOfTheTerminalDoesntUndoAWebhookThatArrivedFirst() {
        Invoice invoice = paid();
        applyRefundNotification(invoice, refund(CANCEL_OR_REFUND, true, "REF1", 1200L, NOW.plusSeconds(3)));

        assertThat(applyRefund(invoice, accepted("REF1"), TERMINAL, NOW)).isFalse();
        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REFUNDED);

        // Without the reference of the refund, the date of the webhook tells.
        Invoice withoutReference = paid();
        applyRefundNotification(withoutReference, refund(REFUND, true, "REF2", 1200L, NOW.plusSeconds(3)));

        assertThat(applyRefund(withoutReference, accepted(null), TERMINAL, NOW)).isFalse();
        assertThat(withoutReference.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REFUNDED);
    }

    @Test
    void aRefundRefusedByTheTerminalOrLaterFailsAndCanBeTriedAgain() {
        Invoice invoice = paid();
        TerminalOutcome refused = new TerminalOutcome(TerminalOutcome.Result.DECLINED,
                "The refund was refused: Not allowed.", "Not allowed", null, null, null, null, null);

        assertThat(applyRefund(invoice, refused, TERMINAL, NOW)).isTrue();

        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.FAILED);
        assertThat(invoice.getRefundFailureReason()).isEqualTo("Not allowed");
        assertThat(notRefundable(invoice)).isNull();

        Invoice refusedLater = paid();
        applyRefund(refusedLater, accepted("REF1"), TERMINAL, NOW);

        assertThat(applyRefundNotification(refusedLater, refund(REFUND, false, "REF1", 1200L, NOW.plusSeconds(5))))
                .isTrue();

        assertThat(refusedLater.getRefundStatus()).isEqualTo(Invoice.RefundStatus.FAILED);
        assertThat(refusedLater.getRefundFailureReason()).isEqualTo("Insufficient balance");
        assertThat(refundedAmount(refusedLater)).isZero();
    }

    @Test
    void aRefundThatFailsOrIsReturnedAfterItsConfirmationGivesItsAmountBack() {
        for (String eventCode : List.of(REFUND_FAILED, REFUNDED_REVERSED)) {
            Invoice invoice = paid();
            applyRefund(invoice, accepted("REF1"), TERMINAL, NOW);
            applyRefundNotification(invoice, refund(REFUND, true, "REF1", 1200L, NOW.plusSeconds(5)));
            RefundNotification undone = new RefundNotification(eventCode, true, "REF1", "PSP1", 1200L, "Account closed",
                    null, NOW.plus(Duration.ofDays(2)));

            assertThat(applyRefundNotification(invoice, undone)).isTrue();
            assertThat(applyRefundNotification(invoice, undone)).isFalse();

            assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.FAILED);
            assertThat(refundedAmount(invoice)).isZero();
            assertThat(invoice.getRefundFailureReason()).isEqualTo(REFUND_FAILED.equals(eventCode)
                    ? "The refund failed: Account closed"
                    : "The refund was returned: Account closed");
            assertThat(notRefundable(invoice)).isNull();
        }
    }

    @Test
    void aConfirmationArrivingAfterTheFailureOfTheSameRefundIsIgnored() {
        Invoice invoice = paid();
        applyRefund(invoice, accepted("REF1"), TERMINAL, NOW);

        assertThat(applyRefundNotification(invoice, new RefundNotification(REFUND_FAILED, true, "REF1", "PSP1", 1200L,
                null, null, NOW.plusSeconds(9)))).isTrue();
        assertThat(applyRefundNotification(invoice, refund(REFUND, true, "REF1", 1200L, NOW.plusSeconds(5)))).isFalse();

        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.FAILED);
        assertThat(invoice.getRefundFailureReason()).isEqualTo("The refund failed.");
        assertThat(refundedAmount(invoice)).isZero();
    }

    @Test
    void aPartialRefundMadeOtherwiseLeavesTheRestToRefund() {
        Invoice invoice = paid();

        assertThat(applyRefundNotification(invoice, refund(REFUND, true, "CA1", 200L, NOW))).isTrue();

        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REFUNDED);
        assertThat(invoice.getRefundTerminalId()).isNull();
        assertThat(refundedAmount(invoice)).isEqualTo(200L);
        assertThat(refundableAmount(invoice)).isEqualTo(1000L);
        assertThat(notRefundable(invoice)).isNull();
    }

    @Test
    void anotherRefundDoesntEndTheWaitForTheOneRequestedAtTheTerminal() {
        Invoice invoice = paid();
        applyRefund(invoice, accepted("REF1"), TERMINAL, NOW);

        assertThat(applyRefundNotification(invoice, refund(REFUND, true, "CA1", 200L, NOW.minus(Duration.ofDays(1)))))
                .isTrue();
        assertThat(applyRefundNotification(invoice, refund(REFUND, false, "CA2", 300L, NOW))).isFalse();

        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REQUESTED);
        assertThat(invoice.getRefundPspReference()).isEqualTo("REF1");
        assertThat(refundedAmount(invoice)).isEqualTo(200L);
    }

    @Test
    void cancellingAPaymentNotCapturedYetSaysTheCustomerWasntCharged() {
        Invoice invoice = paid();

        applyRefundNotification(invoice, new RefundNotification(CANCEL_OR_REFUND, true, "REF1", "PSP1", 1200L, null,
                "cancel", NOW));

        assertThat(invoice.getEvents()).extracting(InvoiceEvent::getDetail)
                .containsExactly("Payment cancelled: the customer wasn't charged.");
    }

    @Test
    void theCardOfAPaymentShowsByItsBrandAndLastDigits() {
        assertThat(card("visa", "411111******1111")).isEqualTo(" with Visa •••• 1111");
        assertThat(card("mc", null)).isEqualTo(" with Mastercard");
        assertThat(card(null, "1111")).isEqualTo(" with card •••• 1111");
        assertThat(card(null, null)).isEmpty();
        assertThat(lastFour("4111********")).isNull();
    }

    private static Invoice invoice(Invoice.Status status) {
        Invoice invoice = new Invoice();
        invoice.setNumber("INV-2026-0007");
        invoice.setStatus(status);
        invoice.setCurrency("EUR");
        invoice.setTotal(1200L);
        return invoice;
    }

    private static Invoice paid() {
        Invoice invoice = invoice(Invoice.Status.PAID);
        invoice.setPspReference("PSP1");
        invoice.setPaidAt(PAID_AT);
        return invoice;
    }

    private static TerminalOutcome approved(String pspReference) {
        return new TerminalOutcome(TerminalOutcome.Result.APPROVED, null, null, pspReference, "tx." + pspReference,
                PAID_AT, "visa", "411111******1111");
    }

    /** The terminal passed the refund on. */
    private static TerminalOutcome accepted(String refundReference) {
        return new TerminalOutcome(TerminalOutcome.Result.APPROVED, null, null, refundReference,
                refundReference != null ? "tx." + refundReference : null, NOW, null, null);
    }

    private static RefundNotification refund(String eventCode, boolean success, String pspReference, Long amount,
                                             Instant at) {
        return new RefundNotification(eventCode, success, pspReference, "PSP1", amount,
                success ? null : "Insufficient balance", "refund", at);
    }
}
