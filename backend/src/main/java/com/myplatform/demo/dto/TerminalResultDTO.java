package com.myplatform.demo.dto;

/**
 * How a terminal answered a payment or a refund of an invoice.
 *
 * @param outcome      for a payment: APPROVED, DECLINED, CANCELLED, ERROR (nothing was charged) or UNKNOWN (the answer
 *                     was lost: the card may have been charged). For a refund: REQUESTED (Adyen confirms it later with a
 *                     webhook), DECLINED, ERROR or UNKNOWN
 * @param message      why it didn't succeed, for people; null when it did
 * @param cardBrand    e.g. "visa", null when the terminal didn't read a card
 * @param maskedPan    e.g. "411111******1111"
 * @param pspReference the PSP reference of the payment or of the refund
 * @param invoice      the invoice once the answer is applied
 */
public record TerminalResultDTO(String outcome,
                                String message,
                                String cardBrand,
                                String maskedPan,
                                String pspReference,
                                InvoiceDTO invoice) {
}
