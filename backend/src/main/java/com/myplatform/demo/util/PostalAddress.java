package com.myplatform.demo.util;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

/** A postal address as the account statements print it, in the order of its country. */
public final class PostalAddress {

    private PostalAddress() {
    }

    /**
     * The street lines, then "San Francisco, CA 94107" in the US, "London" and "W1T 3HE" in the UK,
     * "1011 DJ Amsterdam" elsewhere, then the name of the country. Blank parts are left out.
     */
    public static List<String> lines(List<String> street, String postalCode, String city, String stateOrProvince,
                                     String country) {
        List<String> lines = new ArrayList<>();
        street.forEach(line -> addIfPresent(lines, line));
        String countryCode = country != null ? country.trim() : "";
        if ("US".equals(countryCode) || "CA".equals(countryCode) || "AU".equals(countryCode)) {
            addIfPresent(lines, join(", ", city, join(" ", stateOrProvince, postalCode)));
        } else if ("GB".equals(countryCode)) {
            addIfPresent(lines, city);
            addIfPresent(lines, postalCode);
        } else {
            addIfPresent(lines, join(" ", postalCode, city));
            addIfPresent(lines, stateOrProvince);
        }
        if (!countryCode.isEmpty()) {
            lines.add(new Locale("", countryCode).getDisplayCountry(Locale.ENGLISH));
        }
        return lines;
    }

    /** The non-blank parts, trimmed; null when there are none. */
    public static String join(String separator, String... parts) {
        String joined = Arrays.stream(parts)
                .filter(part -> part != null && !part.isBlank())
                .map(String::trim)
                .collect(Collectors.joining(separator));
        return joined.isEmpty() ? null : joined;
    }

    private static void addIfPresent(List<String> lines, String value) {
        if (value != null && !value.isBlank()) {
            lines.add(value.trim());
        }
    }
}
