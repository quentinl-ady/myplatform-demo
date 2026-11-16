package com.myplatform.demo.dto;

/**
 * A terminal that can collect and refund the payments of invoices: boarded in a store of the user.
 *
 * @param storeReference the reference of the store, as the user named it
 */
public record InvoiceTerminalDTO(String id, String model, String storeId, String storeReference, String storeCity) {
}
