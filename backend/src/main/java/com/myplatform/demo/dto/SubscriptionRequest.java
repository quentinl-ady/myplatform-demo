package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A subscription as the user enters it. The start date defaults to today.
 *
 * @param price      per billing cycle, in minor units, excluding VAT
 * @param vatRate    percent, up to 2 decimals
 * @param frequency  MONTHLY or YEARLY
 * @param autoRescue Adyen Auto Rescue retries the refused card charges, when the platform has it
 * @param rescueDays how long Auto Rescue retries a charge, from 1 to 48 days; 30 when null
 */
public record SubscriptionRequest(Long customerId,
                                  String plan,
                                  Long price,
                                  BigDecimal vatRate,
                                  String frequency,
                                  LocalDate startDate,
                                  Boolean autoRescue,
                                  Integer rescueDays) {
}
