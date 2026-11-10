package com.myplatform.demo.util;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * The billing cycles of a subscription, numbered from 1. Each cycle starts a whole number of periods after the start
 * date, counted from the start date rather than from the previous cycle: a subscription started on 31 January bills
 * on 28 February, then on 31 March again.
 */
public final class SubscriptionCycles {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter FULL = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private SubscriptionCycles() {
    }

    /** The first day of the cycle. */
    public static LocalDate periodStart(LocalDate startDate, int months, int cycle) {
        if (months < 1) {
            throw new IllegalArgumentException("A billing period lasts at least a month.");
        }
        if (cycle < 1) {
            throw new IllegalArgumentException("Billing cycles are numbered from 1.");
        }
        return startDate.plusMonths((long) months * (cycle - 1));
    }

    /** The last day of the cycle: the day before the next one starts. */
    public static LocalDate periodEnd(LocalDate startDate, int months, int cycle) {
        return periodStart(startDate, months, cycle + 1).minusDays(1);
    }

    /** The period as an invoice line shows it: "1–30 Nov 2026", "9 Nov – 8 Dec 2026", "9 Dec 2026 – 8 Jan 2027". */
    public static String periodLabel(LocalDate start, LocalDate end) {
        if (start.getYear() != end.getYear()) {
            return FULL.format(start) + " – " + FULL.format(end);
        }
        if (start.getMonth() != end.getMonth()) {
            return DAY_MONTH.format(start) + " – " + FULL.format(end);
        }
        return DAY.format(start) + "–" + FULL.format(end);
    }
}
