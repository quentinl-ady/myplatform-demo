package com.myplatform.demo.dto;

import java.time.Instant;

/**
 * The Verification of Payee of the supplier of a bill, before the bill is paid by transfer.
 *
 * @param result      as Adyen returns it: nameMatch, partialNameMatch, noNameMatch, nameMatchNotSupported...;
 *                    notAvailable when transfers to the supplier's bank have no check, error when the check failed
 * @param name        the name the supplier's bank has, for a partial match
 * @param description what the result means for the payment
 */
public record PayeeCheckDTO(Long billId,
                            String number,
                            Long supplierId,
                            String supplierName,
                            String bankAccount,
                            String result,
                            String name,
                            String description,
                            Instant checkedAt) {
}
