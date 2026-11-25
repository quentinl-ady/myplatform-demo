package com.myplatform.demo.dto;

import java.util.List;

/** How much of the card's spending limits is used, as calculated by Adyen at {@code calculatedAt}. */
public record CardLimits(String calculatedAt, List<Usage> limits) {

    /**
     * @param unit     {@code amount} (values in minor units of {@code currency}) or {@code count} (number of payments)
     * @param interval when the counter resets: lifetime, daily, weekly, monthly, rolling, sliding...
     */
    public record Usage(String transactionRuleId, String unit, long limit, long spent, long remaining,
                        String currency, String interval) {
    }
}
