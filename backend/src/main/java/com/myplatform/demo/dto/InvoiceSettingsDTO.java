package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the invoice form needs.
 *
 * @param country           the country of the user, which new customers default to
 * @param taxLabel          VAT, GST or Sales tax, depending on the country of the user
 * @param vatRates          the rates of the country, the standard one first
 * @param nextNumber        the number the next invoice gets
 * @param paymentLinksIssue why invoices can't be sent yet, null when they can
 */
public record InvoiceSettingsDTO(String currency,
                                 String country,
                                 String taxLabel,
                                 List<BigDecimal> vatRates,
                                 BigDecimal defaultVatRate,
                                 int paymentTermsDays,
                                 String nextNumber,
                                 boolean paymentLinksReady,
                                 String paymentLinksIssue) {
}
