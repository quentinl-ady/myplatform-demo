package com.myplatform.demo.dto;

import com.myplatform.demo.model.RecipientCountry;
import com.myplatform.demo.util.LedgerAccounts;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the bill and supplier forms need.
 *
 * @param categories         the expense accounts bills are booked to
 * @param bankAccountFormat  the format of the suppliers' bank details, as the transfers of the account take them;
 *                           null when its currency has no transfers
 * @param recipientCountries the countries transfers can go to, with the bank details Adyen accepts in TEST
 * @param transfersIssue     why bills can't be paid by transfer, null when they can
 * @param cardsIssue         why bills can't be paid with a single-use card, null when they can
 * @param cardBrands         the networks a single-use card can be issued on, e.g. mc
 */
public record BillSettingsDTO(String currency,
                              String country,
                              String taxLabel,
                              List<BigDecimal> vatRates,
                              BigDecimal defaultVatRate,
                              int paymentTermsDays,
                              String nextNumber,
                              List<LedgerAccounts.Account> categories,
                              String bankAccountFormat,
                              List<RecipientCountry> recipientCountries,
                              String transfersIssue,
                              String cardsIssue,
                              List<String> cardBrands) {
}
