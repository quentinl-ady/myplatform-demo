package com.myplatform.demo.util;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SubscriptionCyclesTest {

    @Test
    void aMonthlyCycleStartsOnTheDayOfTheStartDateOrTheLastDayOfAShorterMonth() {
        LocalDate start = LocalDate.of(2026, 1, 31);

        assertThat(SubscriptionCycles.periodStart(start, 1, 1)).isEqualTo(start);
        assertThat(SubscriptionCycles.periodStart(start, 1, 2)).isEqualTo(LocalDate.of(2026, 2, 28));
        assertThat(SubscriptionCycles.periodStart(start, 1, 3)).isEqualTo(LocalDate.of(2026, 3, 31));
        assertThat(SubscriptionCycles.periodStart(start, 1, 4)).isEqualTo(LocalDate.of(2026, 4, 30));
        assertThat(SubscriptionCycles.periodStart(start, 1, 13)).isEqualTo(LocalDate.of(2027, 1, 31));
    }

    @Test
    void aCycleEndsTheDayBeforeTheNextOneStarts() {
        LocalDate start = LocalDate.of(2026, 1, 31);

        assertThat(SubscriptionCycles.periodEnd(start, 1, 1)).isEqualTo(LocalDate.of(2026, 2, 27));
        assertThat(SubscriptionCycles.periodEnd(start, 1, 2)).isEqualTo(LocalDate.of(2026, 3, 30));
        assertThat(SubscriptionCycles.periodEnd(LocalDate.of(2026, 11, 9), 1, 1)).isEqualTo(LocalDate.of(2026, 12, 8));
        assertThat(SubscriptionCycles.periodEnd(LocalDate.of(2026, 11, 1), 1, 1)).isEqualTo(LocalDate.of(2026, 11, 30));
    }

    @Test
    void aYearlySubscriptionStartedOnALeapDayBillsOnTheLastDayOfFebruary() {
        LocalDate start = LocalDate.of(2028, 2, 29);

        assertThat(SubscriptionCycles.periodStart(start, 12, 2)).isEqualTo(LocalDate.of(2029, 2, 28));
        assertThat(SubscriptionCycles.periodStart(start, 12, 5)).isEqualTo(LocalDate.of(2032, 2, 29));
        assertThat(SubscriptionCycles.periodEnd(start, 12, 1)).isEqualTo(LocalDate.of(2029, 2, 27));
    }

    @Test
    void theLabelOnlyRepeatsTheMonthAndTheYearWhenTheyChange() {
        assertThat(SubscriptionCycles.periodLabel(LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 30)))
                .isEqualTo("1–30 Nov 2026");
        assertThat(SubscriptionCycles.periodLabel(LocalDate.of(2026, 11, 9), LocalDate.of(2026, 12, 8)))
                .isEqualTo("9 Nov – 8 Dec 2026");
        assertThat(SubscriptionCycles.periodLabel(LocalDate.of(2026, 12, 9), LocalDate.of(2027, 1, 8)))
                .isEqualTo("9 Dec 2026 – 8 Jan 2027");
    }

    @Test
    void cyclesAreNumberedFromOneAndLastAtLeastAMonth() {
        LocalDate start = LocalDate.of(2026, 11, 9);

        assertThatThrownBy(() -> SubscriptionCycles.periodStart(start, 1, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Billing cycles are numbered from 1.");
        assertThatThrownBy(() -> SubscriptionCycles.periodEnd(start, 0, 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("A billing period lasts at least a month.");
    }
}
