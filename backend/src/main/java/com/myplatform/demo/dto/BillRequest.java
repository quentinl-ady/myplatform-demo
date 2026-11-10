package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A bill as the user enters it from the supplier's invoice. Amounts are in minor units.
 *
 * @param supplierReference the number of the supplier's invoice
 * @param subtotal          excluding VAT
 * @param vatRate           percent, e.g. 20 or 5.5
 * @param category          the expense account, e.g. 6210; the supplier's default one when null
 */
public record BillRequest(Long supplierId,
                          String supplierReference,
                          LocalDate issueDate,
                          LocalDate dueDate,
                          String description,
                          Long subtotal,
                          BigDecimal vatRate,
                          String category) {
}
