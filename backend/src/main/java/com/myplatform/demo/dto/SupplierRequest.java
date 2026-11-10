package com.myplatform.demo.dto;

/**
 * A supplier as the user enters it. The name and the country are required; the bank details, in the format of the
 * account's currency, only to pay it by transfer.
 *
 * @param defaultCategory the expense account of its bills, e.g. 6210
 * @param vopScenario     TEST only: the Verification of Payee result its checks simulate, e.g. partialNameMatch
 */
public record SupplierRequest(String name,
                              String email,
                              String country,
                              String vatNumber,
                              String iban,
                              String accountNumber,
                              String sortCode,
                              String routingNumber,
                              String defaultCategory,
                              String vopScenario) {
}
