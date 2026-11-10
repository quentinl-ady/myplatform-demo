package com.myplatform.demo.dto;

import java.util.List;

/**
 * The transfer speeds that can pay a bill: the routes Adyen offers from the business account to the bank account of
 * its supplier, within their amount limits.
 *
 * @param speeds regular, fast and instant, the cheapest first; empty with an error
 * @param error  why the routes couldn't be checked, null when they were
 */
public record BillTransferRoutesDTO(Long billId, List<Speed> speeds, String error) {

    /** @param reason why the bill can't be paid at this speed, null when it can */
    public record Speed(String priority, boolean available, String reason) {
    }
}
