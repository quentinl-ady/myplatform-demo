package com.myplatform.demo.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Invoice amounts, in minor units. The VAT is rounded half up on each line, as most accounting software does by
 * default, and the VAT of a rate is the sum of its lines, so the totals always add up to the lines.
 */
public final class InvoiceMath {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private InvoiceMath() {
    }

    public record Amounts(long net, long tax, long gross) {
    }

    public record RatedAmounts(BigDecimal vatRate, Amounts amounts) {
    }

    /** The VAT of one rate: the base it applies to and its amount. */
    public record VatGroup(BigDecimal rate, long base, long tax) {
    }

    /** @param vat one group per rate, the highest rate first */
    public record Totals(long net, long tax, long gross, List<VatGroup> vat) {
    }

    public static Amounts line(long quantity, long unitPrice, BigDecimal vatRate) {
        long net = Math.multiplyExact(quantity, unitPrice);
        long tax = BigDecimal.valueOf(net)
                .multiply(vatRate)
                .divide(HUNDRED, 0, RoundingMode.HALF_UP)
                .longValueExact();
        return new Amounts(net, tax, Math.addExact(net, tax));
    }

    /** Splits an amount that includes VAT, such as a card payment: the VAT is rounded half up, the net amount is the rest. */
    public static Amounts fromGross(long gross, BigDecimal vatRate) {
        long tax = BigDecimal.valueOf(gross)
                .multiply(vatRate)
                .divide(HUNDRED.add(vatRate), 0, RoundingMode.HALF_UP)
                .longValueExact();
        return new Amounts(Math.subtractExact(gross, tax), tax, gross);
    }

    public static Totals totals(List<RatedAmounts> lines) {
        long net = 0;
        long tax = 0;
        // compareTo groups 20 and 20.00 together
        Map<BigDecimal, long[]> byRate = new TreeMap<>(Comparator.reverseOrder());
        for (RatedAmounts line : lines) {
            net = Math.addExact(net, line.amounts().net());
            tax = Math.addExact(tax, line.amounts().tax());
            long[] group = byRate.computeIfAbsent(line.vatRate(), rate -> new long[2]);
            group[0] = Math.addExact(group[0], line.amounts().net());
            group[1] = Math.addExact(group[1], line.amounts().tax());
        }
        List<VatGroup> vat = new ArrayList<>();
        byRate.forEach((rate, group) -> vat.add(new VatGroup(rate, group[0], group[1])));
        return new Totals(net, tax, Math.addExact(net, tax), vat);
    }

    /**
     * The amounts of one unit of a line. Adyen line items are priced per unit, so a line whose amounts don't
     * divide evenly by its quantity is sent as a single item: null in that case.
     */
    public static Amounts perUnit(long quantity, Amounts line) {
        if (quantity <= 0 || line.net() % quantity != 0 || line.tax() % quantity != 0) {
            return null;
        }
        return new Amounts(line.net() / quantity, line.tax() / quantity, line.gross() / quantity);
    }

    /** Adyen takes the tax percentage in minor units: 2000 for 20%, 550 for 5.5%. */
    public static long adyenTaxPercentage(BigDecimal vatRate) {
        return vatRate.movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
}
