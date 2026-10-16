package com.myplatform.demo.util;

import com.adyen.model.checkout.Split;
import com.adyen.model.checkout.SplitAmount;
import com.myplatform.demo.dto.SplitLine;
import com.myplatform.demo.model.SplitSettings;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/** Builds single-seller split instructions: sub-merchant balance account + platform commission (+ fees). */
public final class PaymentSplits {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal MARKETPLACE_COMMISSION_PERCENTAGE = BigDecimal.TEN;

    private PaymentSplits() {
    }

    /** Split applied to marketplace payments when no custom split is chosen. */
    public static SplitSettings marketplaceDefault() {
        return SplitSettings.percentage(MARKETPLACE_COMMISSION_PERCENTAGE.setScale(2), SplitSettings.FeeAllocation.PLATFORM);
    }

    /**
     * Commission for {@code amount}. A FIXED commission is defined for {@code paymentAmount}; for a
     * partial capture it is prorated to the captured amount.
     */
    public static long commission(SplitSettings settings, long amount, long paymentAmount) {
        return switch (settings.getCommissionType()) {
            case PERCENTAGE -> BigDecimal.valueOf(amount)
                    .multiply(settings.getCommissionPercentage())
                    .divide(HUNDRED, 0, RoundingMode.HALF_UP)
                    .longValueExact();
            case FIXED -> amount == paymentAmount
                    ? settings.getCommissionAmount()
                    : BigDecimal.valueOf(settings.getCommissionAmount())
                    .multiply(BigDecimal.valueOf(amount))
                    .divide(BigDecimal.valueOf(paymentAmount), 0, RoundingMode.HALF_UP)
                    .longValueExact();
        };
    }

    /**
     * The commission split has no account, so Adyen books it to the liable balance account. Without a
     * PaymentFee split, Adyen books the payment fees to the liable balance account as well.
     */
    public static List<Split> build(long amount, long commission, String currency, String reference,
                                    String balanceAccountId, SplitSettings.FeeAllocation feeAllocation) {
        List<Split> splits = new ArrayList<>();
        long sellerAmount = amount - commission;
        if (sellerAmount > 0) {
            splits.add(new Split()
                    .type(Split.TypeEnum.BALANCEACCOUNT)
                    .account(balanceAccountId)
                    .amount(new SplitAmount().currency(currency).value(sellerAmount))
                    .reference("SELLER_" + reference));
        }
        if (commission > 0) {
            splits.add(new Split()
                    .type(Split.TypeEnum.COMMISSION)
                    .amount(new SplitAmount().currency(currency).value(commission))
                    .reference("PLATFORM_FEE_" + reference));
        }
        if (feeAllocation == SplitSettings.FeeAllocation.SUB_MERCHANT) {
            splits.add(new Split()
                    .type(Split.TypeEnum.PAYMENTFEE)
                    .account(balanceAccountId)
                    .reference("FEES_" + reference));
        }
        return splits;
    }

    public static List<SplitLine> toLines(List<Split> splits) {
        List<SplitLine> lines = new ArrayList<>();
        for (Split split : splits) {
            lines.add(new SplitLine(
                    split.getType() != null ? split.getType().getValue() : null,
                    split.getAccount(),
                    split.getAmount() != null ? split.getAmount().getValue() : null,
                    split.getReference()));
        }
        return lines;
    }
}
