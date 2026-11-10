package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A card payment the user classified. Amounts are in minor units, those of the payment when it was classified.
 *
 * @param direction      outgoing for a payment, incoming for a refund
 * @param amount         unsigned, VAT included
 * @param net            the amount without VAT
 * @param tax            the VAT included in the amount
 * @param receipt        null when no receipt was added
 * @param receiptMissing a payment without its receipt
 */
public record CardExpenseDTO(Long id,
                             String transferId,
                             String paymentInstrumentId,
                             String merchantName,
                             String mcc,
                             String direction,
                             Long amount,
                             String currency,
                             Instant occurredAt,
                             String category,
                             String categoryName,
                             BigDecimal vatRate,
                             Long net,
                             Long tax,
                             String note,
                             Receipt receipt,
                             boolean receiptMissing,
                             Instant updatedAt) {

    /** @param size bytes */
    public record Receipt(String name, String contentType, int size, Instant uploadedAt) {
    }
}
