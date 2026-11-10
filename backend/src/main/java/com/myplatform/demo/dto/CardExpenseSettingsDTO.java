package com.myplatform.demo.dto;

import com.myplatform.demo.util.LedgerAccounts;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the form of a card expense offers.
 *
 * @param categories      the expense accounts a payment can be booked to
 * @param maxReceiptBytes the largest receipt accepted
 * @param receiptTypes    the content types of the receipts accepted
 */
public record CardExpenseSettingsDTO(String currency,
                                     String taxLabel,
                                     List<BigDecimal> vatRates,
                                     BigDecimal defaultVatRate,
                                     List<LedgerAccounts.Account> categories,
                                     int maxReceiptBytes,
                                     List<String> receiptTypes) {
}
