package com.myplatform.demo.dto;

import java.util.List;

/**
 * The transfers created for a batch of bills. They wait for one approval, with SCA, on the Batch transfers page.
 *
 * @param results one per bill, in the order of the request
 */
public record BillPaymentResultDTO(List<Item> results, int created, int failed) {

    /** @param error why no transfer was created for this bill, null when one was */
    public record Item(Long billId, String number, String supplierName, long amount, String currency,
                       String transferId, String error) {
    }
}
