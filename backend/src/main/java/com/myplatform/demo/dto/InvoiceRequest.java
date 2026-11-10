package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * An invoice as the user enters it. The issue date defaults to today and the due date to the payment terms.
 */
public record InvoiceRequest(Long customerId,
                             LocalDate issueDate,
                             LocalDate dueDate,
                             String notes,
                             List<Line> lines) {

    /**
     * @param unitPrice minor units, excluding VAT
     * @param vatRate   percent, up to 2 decimals
     */
    public record Line(String description, Long quantity, Long unitPrice, BigDecimal vatRate) {
    }
}
