package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the subscription form needs.
 *
 * @param country             the country of the account, which new customers default to
 * @param autoRescueAvailable Adyen enabled Auto Rescue on the merchant account, so subscriptions can use it
 * @param issue               why the account can't start subscriptions yet, null when it can
 */
public record SubscriptionSettingsDTO(String currency,
                                      String country,
                                      String taxLabel,
                                      List<BigDecimal> vatRates,
                                      BigDecimal defaultVatRate,
                                      boolean autoRescueAvailable,
                                      int defaultRescueDays,
                                      int maxRescueDays,
                                      String issue) {
}
