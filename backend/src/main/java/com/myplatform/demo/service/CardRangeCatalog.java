package com.myplatform.demo.service;

import com.myplatform.demo.dto.CardNetworkOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Card ranges (BINs) configured on the balance platform. Adyen finds the range from the brand variant, the issuing
 * country and the currency of the balance account, and has no API to list them, so they are declared in
 * adyen.issuing.card-ranges as brandVariant:issuingCountryCode:currency entries, in order of preference.
 */
@Component
public class CardRangeCatalog {

    private static final Pattern COUNTRY_CODE = Pattern.compile("[A-Z]{2}");
    private static final Pattern CURRENCY_CODE = Pattern.compile("[A-Z]{3}");

    /**
     * @param brand        visa or mc
     * @param currencyCode null for a range built from the legacy settings, which don't give its currency
     */
    public record CardRange(String brand, String brandVariant, String countryCode, String currencyCode) {

        boolean issues(String brand, String currency) {
            return this.brand.equalsIgnoreCase(brand) && (currencyCode == null || currencyCode.equalsIgnoreCase(currency));
        }
    }

    private final List<CardRange> ranges;

    public CardRangeCatalog(@Value("${adyen.issuing.card-ranges:}") String cardRanges,
                            @Value("${adyen.issuing.country:}") String issuingCountry,
                            @Value("${adyen.issuing.visa.subvariant:}") String visaSubvariant,
                            @Value("${adyen.issuing.mastercard.subvariant:}") String mcSubvariant) {
        this.ranges = cardRanges.isBlank()
                ? legacyRanges(issuingCountry.trim(), visaSubvariant.trim(), mcSubvariant.trim())
                : parse(cardRanges);
    }

    /** The first range issued in the preferred country (the account holder's), otherwise the first configured one. */
    public Optional<CardRange> find(String brand, String currency, String preferredCountry) {
        List<CardRange> matches = ranges.stream().filter(range -> range.issues(brand, currency)).toList();
        return matches.stream()
                .filter(range -> range.countryCode().equalsIgnoreCase(preferredCountry))
                .findFirst()
                .or(() -> matches.stream().findFirst());
    }

    public List<CardNetworkOption> networks() {
        Map<String, Set<String>> currenciesByBrand = new LinkedHashMap<>();
        Set<String> anyCurrency = new HashSet<>();
        for (CardRange range : ranges) {
            Set<String> currencies = currenciesByBrand.computeIfAbsent(range.brand(), brand -> new LinkedHashSet<>());
            if (range.currencyCode() == null) {
                anyCurrency.add(range.brand());
            } else {
                currencies.add(range.currencyCode());
            }
        }
        return currenciesByBrand.entrySet().stream()
                .map(entry -> new CardNetworkOption(entry.getKey(),
                        anyCurrency.contains(entry.getKey()) ? null : List.copyOf(entry.getValue())))
                .toList();
    }

    // Keeps the previous behaviour: the brand comes from the setting it is in, and Adyen checks the currency.
    private static List<CardRange> legacyRanges(String country, String visaSubvariant, String mcSubvariant) {
        List<CardRange> legacy = new ArrayList<>();
        if (!visaSubvariant.isEmpty()) {
            legacy.add(new CardRange("visa", visaSubvariant, country, null));
        }
        if (!mcSubvariant.isEmpty()) {
            legacy.add(new CardRange("mc", mcSubvariant, country, null));
        }
        return List.copyOf(legacy);
    }

    private static List<CardRange> parse(String cardRanges) {
        List<CardRange> parsed = new ArrayList<>();
        for (String entry : cardRanges.split(",")) {
            if (entry.isBlank()) {
                continue;
            }
            String[] parts = entry.trim().split(":");
            String variant = parts.length == 3 ? parts[0].trim() : "";
            String country = parts.length == 3 ? parts[1].trim().toUpperCase(Locale.ROOT) : "";
            String currency = parts.length == 3 ? parts[2].trim().toUpperCase(Locale.ROOT) : "";
            String brand = brandOf(variant);
            if (brand == null || !COUNTRY_CODE.matcher(country).matches() || !CURRENCY_CODE.matcher(currency).matches()) {
                throw new IllegalStateException("Invalid adyen.issuing.card-ranges entry '" + entry.trim()
                        + "': expected brandVariant:issuingCountryCode:currency, for example mc_credit_mco:FR:EUR");
            }
            parsed.add(new CardRange(brand, variant, country, currency));
        }
        return List.copyOf(parsed);
    }

    private static String brandOf(String brandVariant) {
        String variant = brandVariant.toLowerCase(Locale.ROOT);
        if (variant.startsWith("visa")) {
            return "visa";
        }
        return variant.startsWith("mc") ? "mc" : null;
    }
}
