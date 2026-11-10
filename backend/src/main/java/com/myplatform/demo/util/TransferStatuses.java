package com.myplatform.demo.util;

import java.util.Set;

/**
 * What the status of a transfer, as Adyen reports it, means for the bill it pays. A transfer that waits for its
 * approval is "received" with the reason "pending", like any transfer Adyen just received: "received" tells nothing
 * new about the payment.
 */
public final class TransferStatuses {

    public enum Outcome { PENDING_APPROVAL, PROCESSING, PAID, FAILED }

    private static final String RECEIVED = "received";
    private static final String APPROVAL_EXPIRED = "approvalExpired";
    private static final Set<String> AWAITING_APPROVAL = Set.of("approvalPending", "pendingApproval");
    private static final Set<String> FAILED = Set.of("cancelled", "error", "expired", "failed", "refused", "rejected",
            "returned");
    private static final Set<String> BANK_TRANSFER_PAID = Set.of("booked", "credited");
    /** A card payment is booked once the merchant captured it. */
    private static final Set<String> CARD_PAYMENT_PAID = Set.of("captured", "booked");

    private TransferStatuses() {
    }

    /** Null when the status tells nothing new. */
    public static Outcome ofBankTransfer(String status, String reason) {
        if (APPROVAL_EXPIRED.equals(reason)) {
            return Outcome.FAILED;
        }
        if (status == null || status.isBlank() || RECEIVED.equals(status)) {
            return null;
        }
        if (FAILED.contains(status)) {
            return Outcome.FAILED;
        }
        if (AWAITING_APPROVAL.contains(status)) {
            return Outcome.PENDING_APPROVAL;
        }
        return BANK_TRANSFER_PAID.contains(status) ? Outcome.PAID : Outcome.PROCESSING;
    }

    /** Whether a transfer created with a review still waits for its approval, so it can still be approved or cancelled. */
    public static boolean awaitsApproval(String status, String reason) {
        Outcome outcome = ofBankTransfer(status, reason);
        return outcome == null || outcome == Outcome.PENDING_APPROVAL;
    }

    /** Null when the status tells nothing new. A card payment never waits for an approval. */
    public static Outcome ofCardPayment(String status) {
        if (status == null || status.isBlank() || RECEIVED.equals(status) || AWAITING_APPROVAL.contains(status)) {
            return null;
        }
        if (FAILED.contains(status)) {
            return Outcome.FAILED;
        }
        return CARD_PAYMENT_PAID.contains(status) ? Outcome.PAID : Outcome.PROCESSING;
    }
}
