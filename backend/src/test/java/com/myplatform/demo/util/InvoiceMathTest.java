package com.myplatform.demo.util;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class InvoiceMathTest {

    @Test
    void theVatOfALineIsRoundedHalfUp() {
        assertThat(InvoiceMath.line(3, 333, new BigDecimal("5.50")))
                .isEqualTo(new InvoiceMath.Amounts(999, 55, 1_054)); // 54.945
        assertThat(InvoiceMath.line(1, 1_999, new BigDecimal("20.00")))
                .isEqualTo(new InvoiceMath.Amounts(1_999, 400, 2_399)); // 399.8
        assertThat(InvoiceMath.line(1, 1_002, new BigDecimal("20.00")))
                .isEqualTo(new InvoiceMath.Amounts(1_002, 200, 1_202)); // 200.4
    }

    @Test
    void theTotalsAddUpTheLinesPerRateTheHighestRateFirst() {
        InvoiceMath.Totals totals = InvoiceMath.totals(List.of(
                rated("5.5", InvoiceMath.line(3, 333, new BigDecimal("5.5"))),
                rated("20.00", InvoiceMath.line(2, 50_000, new BigDecimal("20"))),
                rated("20", InvoiceMath.line(1, 1_999, new BigDecimal("20")))));

        assertThat(totals.net()).isEqualTo(999 + 100_000 + 1_999);
        assertThat(totals.tax()).isEqualTo(55 + 20_000 + 400);
        assertThat(totals.gross()).isEqualTo(totals.net() + totals.tax());
        assertThat(totals.vat()).extracting(InvoiceMath.VatGroup::base, InvoiceMath.VatGroup::tax)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(101_999L, 20_400L),
                        org.assertj.core.groups.Tuple.tuple(999L, 55L));
    }

    @Test
    void anAmountThatIncludesVatIsSplitTheVatRoundedHalfUp() {
        assertThat(InvoiceMath.fromGross(1_100, new BigDecimal("10.00")))
                .isEqualTo(new InvoiceMath.Amounts(1_000, 100, 1_100));
        assertThat(InvoiceMath.fromGross(1_000, new BigDecimal("20.00")))
                .isEqualTo(new InvoiceMath.Amounts(833, 167, 1_000)); // 166.67
        assertThat(InvoiceMath.fromGross(1_055, new BigDecimal("5.50")))
                .isEqualTo(new InvoiceMath.Amounts(1_000, 55, 1_055));
        assertThat(InvoiceMath.fromGross(999, BigDecimal.ZERO)).isEqualTo(new InvoiceMath.Amounts(999, 0, 999));
    }

    @Test
    void aLineIsPricedPerUnitOnlyWhenItDividesEvenly() {
        assertThat(InvoiceMath.perUnit(2, new InvoiceMath.Amounts(2_000, 400, 2_400)))
                .isEqualTo(new InvoiceMath.Amounts(1_000, 200, 1_200));
        assertThat(InvoiceMath.perUnit(3, new InvoiceMath.Amounts(999, 55, 1_054))).isNull();
    }

    @Test
    void adyenTakesTheTaxPercentageInMinorUnits() {
        assertThat(InvoiceMath.adyenTaxPercentage(new BigDecimal("20.00"))).isEqualTo(2_000);
        assertThat(InvoiceMath.adyenTaxPercentage(new BigDecimal("5.5"))).isEqualTo(550);
    }

    private static InvoiceMath.RatedAmounts rated(String rate, InvoiceMath.Amounts amounts) {
        return new InvoiceMath.RatedAmounts(new BigDecimal(rate), amounts);
    }
}
