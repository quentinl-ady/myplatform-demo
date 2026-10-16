package com.myplatform.demo.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * Single-seller split: the platform commission is booked to the liable balance account and the rest
 * of the amount to the sub-merchant's balance account.
 */
@Embeddable
@Getter
@Setter
public class SplitSettings {

    public enum CommissionType { PERCENTAGE, FIXED }

    /** Who pays the payment fees (interchange, scheme fees and Adyen fees). */
    public enum FeeAllocation { PLATFORM, SUB_MERCHANT }

    @Enumerated(EnumType.STRING)
    private CommissionType commissionType;

    /** Percent of the amount, up to 2 decimals. Used when commissionType is PERCENTAGE. */
    @Column(precision = 5, scale = 2)
    private BigDecimal commissionPercentage;

    /** Minor units of the payment currency, for the full payment amount. Used when commissionType is FIXED. */
    private Long commissionAmount;

    @Enumerated(EnumType.STRING)
    private FeeAllocation feeAllocation;

    public static SplitSettings percentage(BigDecimal percentage, FeeAllocation feeAllocation) {
        SplitSettings settings = new SplitSettings();
        settings.setCommissionType(CommissionType.PERCENTAGE);
        settings.setCommissionPercentage(percentage);
        settings.setFeeAllocation(feeAllocation);
        return settings;
    }
}
