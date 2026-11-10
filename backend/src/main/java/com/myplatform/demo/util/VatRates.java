package com.myplatform.demo.util;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/** The tax rates offered on invoices, by country of the seller: the standard rate first, then the reduced ones, then 0. */
public final class VatRates {

    private static final Map<String, List<String>> RATES = Map.ofEntries(
            Map.entry("AT", List.of("20", "13", "10")),
            Map.entry("AU", List.of("10")),
            Map.entry("BE", List.of("21", "12", "6")),
            Map.entry("CA", List.of("5")),
            Map.entry("CH", List.of("8.1", "3.8", "2.6")),
            Map.entry("CZ", List.of("21", "12")),
            Map.entry("DE", List.of("19", "7")),
            Map.entry("DK", List.of("25")),
            Map.entry("ES", List.of("21", "10", "4")),
            Map.entry("FI", List.of("25.5", "14", "10")),
            Map.entry("FR", List.of("20", "10", "5.5", "2.1")),
            Map.entry("GB", List.of("20", "5")),
            Map.entry("IE", List.of("23", "13.5", "9")),
            Map.entry("IT", List.of("22", "10", "5", "4")),
            Map.entry("LU", List.of("17", "14", "8", "3")),
            Map.entry("NL", List.of("21", "9")),
            Map.entry("NO", List.of("25", "15", "12")),
            Map.entry("NZ", List.of("15")),
            Map.entry("PL", List.of("23", "8", "5")),
            Map.entry("PT", List.of("23", "13", "6")),
            Map.entry("SE", List.of("25", "12", "6")),
            Map.entry("SG", List.of("9")),
            Map.entry("US", List.of()));
    private static final List<String> DEFAULT = List.of("20", "10", "5");
    private static final Set<String> GST = Set.of("AU", "CA", "NZ", "SG");

    private VatRates() {
    }

    public static List<BigDecimal> forCountry(String country) {
        List<String> rates = RATES.getOrDefault(country, DEFAULT);
        return Stream.concat(rates.stream(), Stream.of("0"))
                .map(rate -> new BigDecimal(rate).setScale(2))
                .toList();
    }

    /** What the tax is called on the invoices of the country. */
    public static String taxLabel(String country) {
        if ("US".equals(country)) {
            return "Sales tax";
        }
        return GST.contains(country) ? "GST" : "VAT";
    }
}
