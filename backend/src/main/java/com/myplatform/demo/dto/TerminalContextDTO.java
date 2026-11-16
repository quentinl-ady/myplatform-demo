package com.myplatform.demo.dto;

/**
 * The store and the business a terminal collects the payments of invoices for: the context of the terminal app.
 *
 * @param companyName the business, as its customers know it
 * @param currency    the currency of its invoices
 */
public record TerminalContextDTO(String terminalId,
                                 String model,
                                 String storeId,
                                 String storeReference,
                                 String storeCity,
                                 String userId,
                                 String companyName,
                                 String currency) {
}
