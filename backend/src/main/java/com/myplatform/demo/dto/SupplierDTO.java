package com.myplatform.demo.dto;

import java.time.Instant;

/**
 * A supplier of the user, with what is still to pay it.
 *
 * @param bankAccountFormat iban, accountNumberSortCode or accountNumberRoutingNumber; null without bank details
 * @param bankAccount       the account with only its last digits, e.g. FR76 •••• 9742
 * @param bankCountry       the country of the bank
 * @param vopScenario       TEST only: the Verification of Payee result its checks simulate, null for a regular check
 * @param outstanding       minor units of its bills that aren't paid yet
 */
public record SupplierDTO(Long id,
                          String name,
                          String email,
                          String country,
                          String vatNumber,
                          String bankAccountFormat,
                          String iban,
                          String accountNumber,
                          String sortCode,
                          String routingNumber,
                          String bankAccount,
                          String bankCountry,
                          String defaultCategory,
                          String vopScenario,
                          Instant createdAt,
                          int billCount,
                          long outstanding,
                          String currency) {
}
