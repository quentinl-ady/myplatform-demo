package com.myplatform.demo.dto;

import java.time.Instant;

/**
 * A customer of the user, with what it owes.
 *
 * @param outstanding minor units of the user's currency still to be paid on sent invoices
 */
public record CustomerDTO(Long id,
                          String name,
                          String company,
                          String displayName,
                          String email,
                          String country,
                          String vatNumber,
                          String addressLine,
                          String postalCode,
                          String city,
                          String shopperReference,
                          Instant createdAt,
                          int invoiceCount,
                          long outstanding,
                          String currency) {
}
