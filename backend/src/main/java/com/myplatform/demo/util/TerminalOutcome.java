package com.myplatform.demo.util;

import java.time.Instant;

/**
 * How a terminal answered a payment or a refund.
 *
 * @param result        for a refund, APPROVED means Adyen received it: a webhook confirms it later
 * @param message       why it didn't succeed, for people; null when it did
 * @param reason        the refusal reason or the error the terminal gave, if any, e.g. "Not enough balance"
 * @param pspReference  the PSP reference of the payment or of the refund
 * @param transactionId the transaction of the terminal, "tender.pspReference": a refund at a terminal references it
 * @param transactionAt when the terminal made the transaction
 * @param cardBrand     e.g. "visa"
 * @param maskedPan     e.g. "411111******1111", or the last 4 digits
 */
public record TerminalOutcome(Result result,
                              String message,
                              String reason,
                              String pspReference,
                              String transactionId,
                              Instant transactionAt,
                              String cardBrand,
                              String maskedPan) {

    /**
     * DECLINED by the card or its issuer; CANCELLED at the terminal; ERROR: the terminal didn't take the request, so
     * nothing was charged; UNKNOWN: its answer was lost, so the card may have been charged.
     */
    public enum Result { APPROVED, DECLINED, CANCELLED, ERROR, UNKNOWN }

    public static TerminalOutcome of(Result result, String message) {
        return new TerminalOutcome(result, message, null, null, null, null, null, null);
    }
}
