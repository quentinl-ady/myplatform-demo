package com.myplatform.demo.dto;

/**
 * Runs the next billing cycle of a subscription.
 *
 * @param testOutcome TEST only: REFUSED, EXPIRED_CARD or NOT_ENOUGH_BALANCE to have the card charge refused; with
 *                    Auto Rescue, RESCUED_FIRST_RETRY, RESCUED_SECOND_RETRY, NOT_RESCUED or FRAUD to play an Auto
 *                    Rescue scenario. Null to charge normally.
 */
public record SubscriptionChargeRequest(String testOutcome) {
}
