package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.InvoiceEvent;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Currency;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * What a terminal can do with an invoice, and how the answers of the terminal and the refund webhooks change it. The
 * invoice service applies these rules under the lock of the invoice. Webhooks can arrive before the answer of the
 * terminal, and more than once: the rules never undo what a webhook settled, and apply each refund once.
 */
public final class InvoiceTerminalRules {

    public static final String REFUND = "REFUND";
    public static final String CANCEL_OR_REFUND = "CANCEL_OR_REFUND";
    public static final String REFUND_FAILED = "REFUND_FAILED";
    public static final String REFUNDED_REVERSED = "REFUNDED_REVERSED";
    public static final Set<String> REFUND_EVENTS = Set.of(REFUND, CANCEL_OR_REFUND, REFUND_FAILED, REFUNDED_REVERSED);

    /** A refund webhook dated this long before the refund requested at a terminal is about an earlier refund. */
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(2);
    private static final int MAX_REASON = 200;

    private InvoiceTerminalRules() {
    }

    /**
     * The payment a refund at a terminal references.
     *
     * @param transactionId "tender.pspReference" for a payment at a terminal, else "." and its PSP reference
     * @param atTerminal    false for a payment made otherwise: the refund tells its currency
     */
    public record OriginalTransaction(String transactionId, Instant at, boolean atTerminal) {
    }

    /**
     * A refund webhook.
     *
     * @param pspReference      the refund
     * @param originalReference the payment it refunds
     * @param action            for CANCEL_OR_REFUND: "cancel" when the payment wasn't captured yet, else "refund"
     */
    public record RefundNotification(String eventCode, boolean success, String pspReference, String originalReference,
                                     Long amount, String reason, String action, Instant at) {

        public static RefundNotification of(JsonNode item, Instant now) {
            return new RefundNotification(AdyenNotifications.text(item, "eventCode"), AdyenNotifications.success(item),
                    AdyenNotifications.text(item, "pspReference"), AdyenNotifications.text(item, "originalReference"),
                    AdyenNotifications.amountValue(item), AdyenNotifications.text(item, "reason"),
                    AdyenNotifications.additionalData(item, "modification.action"),
                    Objects.requireNonNullElse(AdyenNotifications.eventDate(item), now));
        }
    }

    public static boolean isRefundEvent(String eventCode) {
        return eventCode != null && REFUND_EVENTS.contains(eventCode);
    }

    // ---------- What a terminal can do ----------

    /** Why the invoice can't be paid at a terminal, null when it can. */
    public static String notPayable(Invoice invoice) {
        switch (invoice.getStatus()) {
            case DRAFT -> {
                return "Send the invoice before collecting its payment.";
            }
            case PAID -> {
                return "This invoice is already paid.";
            }
            case VOID -> {
                return "A void invoice can't be paid.";
            }
            default -> {
            }
        }
        if (invoice.getChargeStatus() == Invoice.ChargeStatus.PENDING) {
            return "The charge of " + invoice.getNumber() + " isn't confirmed yet. Try again once it is.";
        }
        if (invoice.getChargeStatus() == Invoice.ChargeStatus.RESCUING) {
            return "Auto Rescue is retrying the charge of " + invoice.getNumber() + ". Stop it from the subscription first.";
        }
        String link = invoice.getPaymentLinkStatus();
        if ("paymentPending".equals(link)) {
            return "A payment of this invoice is in progress. Try again once it's settled.";
        }
        if ("completed".equals(link) || "paid".equals(link)) {
            return "The customer has just paid this invoice.";
        }
        return null;
    }

    /** Why the payment of the invoice can't be refunded at a terminal, null when it can. */
    public static String notRefundable(Invoice invoice) {
        if (invoice.getStatus() != Invoice.Status.PAID) {
            return "Only a paid invoice can be refunded.";
        }
        if (invoice.getPspReference() == null) {
            return "The payment of this invoice isn't confirmed yet, so it can't be refunded. Try again in a few minutes.";
        }
        if (invoice.getRefundStatus() == Invoice.RefundStatus.REQUESTED) {
            return "A refund of this invoice is already in progress.";
        }
        if (refundableAmount(invoice) <= 0) {
            return "This invoice is already refunded.";
        }
        return null;
    }

    public static long refundedAmount(Invoice invoice) {
        return Objects.requireNonNullElse(invoice.getRefundedAmount(), 0L);
    }

    /** What the refunds haven't given back yet. */
    public static long refundableAmount(Invoice invoice) {
        return Math.max(0, invoice.getTotal() - refundedAmount(invoice));
    }

    public static OriginalTransaction original(Invoice invoice, Instant now) {
        if (invoice.getTerminalTransactionId() != null && invoice.getTerminalTransactionAt() != null) {
            return new OriginalTransaction(invoice.getTerminalTransactionId(), invoice.getTerminalTransactionAt(), true);
        }
        return new OriginalTransaction("." + invoice.getPspReference(),
                Objects.requireNonNullElse(invoice.getPaidAt(), now), false);
    }

    // ---------- Answers of the terminal ----------

    /** Applies the answer of the terminal to a payment of the invoice. Returns true when the invoice changed. */
    public static boolean applyPayment(Invoice invoice, TerminalOutcome outcome, String terminalId, Instant now) {
        Instant at = Objects.requireNonNullElse(outcome.transactionAt(), now);
        String psp = outcome.pspReference();
        String card = card(outcome.cardBrand(), outcome.maskedPan());
        switch (outcome.result()) {
            case APPROVED -> {
                String detail = "Paid at terminal " + terminalId + card + ".";
                if (invoice.getStatus() != Invoice.Status.PAID) {
                    invoice.setStatus(Invoice.Status.PAID);
                    invoice.setPaidAt(at);
                    invoice.setPspReference(psp);
                    invoice.setPaymentMethod(outcome.cardBrand());
                    invoice.addEvent(InvoiceEvent.Type.PAID, at, detail, psp);
                    setTerminal(invoice, outcome, terminalId);
                    return true;
                }
                if (psp != null && psp.equals(invoice.getPspReference())) {
                    // The webhook of this payment arrived first: the terminal tells more.
                    boolean changed = setTerminal(invoice, outcome, terminalId);
                    if (invoice.getPaymentMethod() == null && outcome.cardBrand() != null) {
                        invoice.setPaymentMethod(outcome.cardBrand());
                        changed = true;
                    }
                    for (InvoiceEvent event : invoice.getEvents()) {
                        if (event.getType() == InvoiceEvent.Type.PAID && psp.equals(event.getPspReference())
                                && !detail.equals(event.getDetail())) {
                            event.setDetail(detail);
                            changed = true;
                        }
                    }
                    return changed;
                }
                if (psp != null && hasEvent(invoice, InvoiceEvent.Type.PAID, psp)) {
                    return false;
                }
                // Paid otherwise while the customer paid at the terminal.
                invoice.addEvent(InvoiceEvent.Type.PAID, at, "Also paid at terminal " + terminalId + card
                        + ": the invoice was already paid, so refund this payment.", psp);
                return true;
            }
            case DECLINED -> {
                if (invoice.getStatus() != Invoice.Status.SENT
                        || (psp != null && hasEvent(invoice, InvoiceEvent.Type.PAYMENT_REFUSED, psp))) {
                    return false; // paid meanwhile, or the webhook of this payment arrived first
                }
                invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, at, "Payment at terminal " + terminalId + card
                        + " declined" + (outcome.reason() != null ? ": " + outcome.reason() : "") + ".", psp);
                return true;
            }
            default -> {
                return false;
            }
        }
    }

    /**
     * Applies the answer of the terminal to a refund of the invoice. Returns true when the invoice changed.
     *
     * @param requestedAt when the refund was asked of the terminal
     */
    public static boolean applyRefund(Invoice invoice, TerminalOutcome outcome, String terminalId, Instant requestedAt) {
        String psp = outcome.pspReference();
        switch (outcome.result()) {
            case APPROVED -> {
                if (settledSince(invoice, psp, requestedAt)) {
                    return false; // a webhook about this refund arrived first
                }
                invoice.setRefundStatus(Invoice.RefundStatus.REQUESTED);
                invoice.setRefundPspReference(psp);
                invoice.setRefundRequestedAt(requestedAt);
                invoice.setRefundTerminalId(terminalId);
                invoice.setRefundFailureReason(null);
                return true;
            }
            case DECLINED, CANCELLED -> {
                if (psp != null && hasEvent(invoice, InvoiceEvent.Type.REFUNDED, psp)) {
                    return false;
                }
                invoice.setRefundStatus(Invoice.RefundStatus.FAILED);
                invoice.setRefundPspReference(psp);
                invoice.setRefundRequestedAt(requestedAt);
                invoice.setRefundTerminalId(terminalId);
                invoice.setRefundFailureReason(truncate(Objects.requireNonNullElse(outcome.reason(),
                        Objects.requireNonNullElse(outcome.message(), "The terminal refused the refund."))));
                return true;
            }
            default -> {
                return false;
            }
        }
    }

    public static void requestOnlineRefund(Invoice invoice, String pspReference, Instant requestedAt) {
        invoice.setRefundStatus(Invoice.RefundStatus.REQUESTED);
        invoice.setRefundPspReference(pspReference);
        invoice.setRefundRequestedAt(requestedAt);
        invoice.setRefundTerminalId(null);
        invoice.setRefundFailureReason(null);
    }

    /** Whether a webhook about the refund the terminal accepted at requestedAt already settled it. */
    private static boolean settledSince(Invoice invoice, String psp, Instant requestedAt) {
        if (psp != null) {
            return psp.equals(invoice.getRefundPspReference()) || hasEvent(invoice, InvoiceEvent.Type.REFUNDED, psp);
        }
        return invoice.getRefundStatus() == Invoice.RefundStatus.REFUNDED && invoice.getRefundedAt() != null
                && !invoice.getRefundedAt().isBefore(requestedAt.minus(CLOCK_SKEW));
    }

    // ---------- Refund webhooks ----------

    /** Applies a refund webhook to the invoice whose payment it refunds. Returns true when the invoice changed. */
    public static boolean applyRefundNotification(Invoice invoice, RefundNotification notification) {
        if (notification.eventCode() == null) {
            return false;
        }
        return switch (notification.eventCode()) {
            case REFUND, CANCEL_OR_REFUND -> notification.success()
                    ? refunded(invoice, notification)
                    : refundRefused(invoice, notification);
            case REFUND_FAILED, REFUNDED_REVERSED -> notification.success() && refundUndone(invoice, notification);
            default -> false;
        };
    }

    private static boolean refunded(Invoice invoice, RefundNotification notification) {
        String psp = notification.pspReference();
        if (psp == null || hasEvent(invoice, InvoiceEvent.Type.REFUNDED, psp)
                || (invoice.getRefundStatus() == Invoice.RefundStatus.FAILED && psp.equals(invoice.getRefundPspReference()))) {
            return false; // applied already, or this refund failed since
        }
        long amount = notification.amount() != null ? notification.amount() : refundableAmount(invoice);
        invoice.setRefundedAmount(Math.min(invoice.getTotal(), refundedAmount(invoice) + amount));
        invoice.addEvent(InvoiceEvent.Type.REFUNDED, notification.at(), "cancel".equalsIgnoreCase(notification.action())
                ? "Payment cancelled: the customer wasn't charged."
                : "Refunded " + money(amount, invoice.getCurrency())
                + (tracks(invoice, notification) && invoice.getRefundTerminalId() == null ? " online" : "")
                + " to the customer.", psp);
        boolean tracked = tracks(invoice, notification);
        if (!tracked && invoice.getRefundStatus() == Invoice.RefundStatus.REQUESTED) {
            return true; // another refund: the one requested at the terminal is still awaited
        }
        if (!tracked) {
            // Made otherwise than at a terminal of the app.
            invoice.setRefundRequestedAt(null);
            invoice.setRefundTerminalId(null);
        }
        invoice.setRefundStatus(Invoice.RefundStatus.REFUNDED);
        invoice.setRefundPspReference(psp);
        invoice.setRefundedAt(notification.at());
        invoice.setRefundFailureReason(null);
        return true;
    }

    private static boolean refundRefused(Invoice invoice, RefundNotification notification) {
        String psp = notification.pspReference();
        if (psp != null && hasEvent(invoice, InvoiceEvent.Type.REFUNDED, psp)) {
            return false;
        }
        boolean tracked = tracks(invoice, notification);
        if (!tracked && invoice.getRefundStatus() != null) {
            return false; // the refund the invoice shows stands
        }
        if (!tracked) {
            invoice.setRefundRequestedAt(null);
            invoice.setRefundTerminalId(null);
        }
        invoice.setRefundStatus(Invoice.RefundStatus.FAILED);
        invoice.setRefundPspReference(psp);
        invoice.setRefundFailureReason(truncate(notification.reason() != null ? notification.reason() : "The refund was refused."));
        return true;
    }

    /** The refund failed after Adyen accepted it, or the bank returned it: the customer didn't get the money back. */
    private static boolean refundUndone(Invoice invoice, RefundNotification notification) {
        String refund = invoice.getRefundPspReference();
        if (refund == null || !(refund.equals(notification.pspReference()) || refund.equals(notification.originalReference()))) {
            return false; // about another refund
        }
        String what = REFUNDED_REVERSED.equals(notification.eventCode()) ? "The refund was returned" : "The refund failed";
        String reason = truncate(notification.reason() != null ? what + ": " + notification.reason() : what + ".");
        switch (Objects.requireNonNullElse(invoice.getRefundStatus(), Invoice.RefundStatus.FAILED)) {
            case REQUESTED -> {
                invoice.setRefundStatus(Invoice.RefundStatus.FAILED);
                invoice.setRefundFailureReason(reason);
                return true;
            }
            case REFUNDED -> {
                long amount = notification.amount() != null ? notification.amount() : refundedAmount(invoice);
                invoice.setRefundedAmount(Math.max(0, refundedAmount(invoice) - amount));
                invoice.setRefundStatus(Invoice.RefundStatus.FAILED);
                invoice.setRefundFailureReason(reason);
                return true;
            }
            default -> {
                return false; // undone already
            }
        }
    }

    /** Whether the webhook is about the refund the invoice waits for. */
    private static boolean tracks(Invoice invoice, RefundNotification notification) {
        if (invoice.getRefundStatus() != Invoice.RefundStatus.REQUESTED) {
            return false;
        }
        if (invoice.getRefundPspReference() != null) {
            return invoice.getRefundPspReference().equals(notification.pspReference());
        }
        // The terminal didn't tell the reference of the refund: an earlier refund is older than the request.
        return invoice.getRefundRequestedAt() == null
                || !notification.at().isBefore(invoice.getRefundRequestedAt().minus(CLOCK_SKEW));
    }

    // ---------- Helpers ----------

    private static boolean setTerminal(Invoice invoice, TerminalOutcome outcome, String terminalId) {
        boolean changed = !Objects.equals(invoice.getTerminalId(), terminalId)
                || !Objects.equals(invoice.getTerminalTransactionId(), outcome.transactionId())
                || !Objects.equals(invoice.getTerminalTransactionAt(), outcome.transactionAt());
        invoice.setTerminalId(terminalId);
        invoice.setTerminalTransactionId(outcome.transactionId());
        invoice.setTerminalTransactionAt(outcome.transactionAt());
        return changed;
    }

    private static boolean hasEvent(Invoice invoice, InvoiceEvent.Type type, String pspReference) {
        return invoice.getEvents().stream()
                .anyMatch(event -> event.getType() == type && pspReference.equals(event.getPspReference()));
    }

    /** " with Visa •••• 1111", or "" when the terminal didn't tell the card. */
    public static String card(String brand, String maskedPan) {
        String name = PaymentMethodNames.of(brand);
        String lastFour = lastFour(maskedPan);
        if (name == null && lastFour == null) {
            return "";
        }
        return " with " + (name != null ? name : "card") + (lastFour != null ? " •••• " + lastFour : "");
    }

    /** "1111" for "411111******1111", null when the number doesn't end with 4 digits. */
    public static String lastFour(String maskedPan) {
        if (maskedPan == null || maskedPan.length() < 4) {
            return null;
        }
        String end = maskedPan.substring(maskedPan.length() - 4);
        return end.chars().allMatch(Character::isDigit) ? end : null;
    }

    /** "1,200.00 EUR" */
    private static String money(long minorUnits, String currency) {
        int digits;
        try {
            digits = Math.max(Currency.getInstance(currency).getDefaultFractionDigits(), 0);
        } catch (IllegalArgumentException | NullPointerException e) {
            digits = 2;
        }
        return String.format(Locale.ENGLISH, "%,." + digits + "f %s", BigDecimal.valueOf(minorUnits, digits),
                Objects.toString(currency, "")).trim();
    }

    private static String truncate(String value) {
        return value == null || value.length() <= MAX_REASON ? value : value.substring(0, MAX_REASON);
    }
}
