package com.myplatform.demo.dto;

import com.myplatform.demo.model.AccountStatement;
import com.myplatform.demo.util.AccountStatementFile;

/**
 * An account statement of the business account. Its Adyen download URL stays on the backend.
 *
 * @param currency     e.g. "EUR"; null when the file name has none
 * @param periodStart  first day covered, ISO-8601 date; null when the file name has no period
 * @param periodEnd    last day covered, ISO-8601 date; null when the file name has no period
 * @param creationDate when Adyen generated it, ISO-8601 UTC timestamp
 * @param pdfFileName  the name to save the PDF under, e.g. account-statement_2026-10-19_EUR.pdf
 */
public record AccountStatementDTO(String fileName,
                                  String currency,
                                  String periodStart,
                                  String periodEnd,
                                  String creationDate,
                                  String pdfFileName) {

    public static AccountStatementDTO of(AccountStatement statement) {
        AccountStatementFile.Period period = AccountStatementFile.period(statement.getFileName());
        return new AccountStatementDTO(
                statement.getFileName(),
                AccountStatementFile.currency(statement.getFileName()),
                period != null ? period.firstDay().toString() : null,
                period != null ? period.lastDay().toString() : null,
                statement.getCreationDate().toString(),
                AccountStatementFile.pdfName(statement.getFileName())
        );
    }
}
