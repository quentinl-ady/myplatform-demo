package com.myplatform.demo.util;

import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.RecipientCountry;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static com.myplatform.demo.util.AdyenConstants.SEPA_COUNTRIES;

public final class RecipientCountries {

    private RecipientCountries() {}

    // Verification of Payee is only mandatory for banks in the EEA: outside it, the check may not be available.
    private static final Set<String> SEPA_OUTSIDE_EEA = Set.of("AD", "CH", "GB", "MC", "SM", "VA");

    // The TEST environment only accepts the bank details listed in
    // https://docs.adyen.com/platforms/managed-payouts/view-payout-executions#bank-details-for-testing
    private static final Map<String, String> TEST_IBANS = Map.ofEntries(
            Map.entry("CH", "CH5204835012345671000"),
            Map.entry("CZ", "CZ6508000000192000145399"),
            Map.entry("DE", "DE14100100109876543210"),
            Map.entry("DK", "DK9206850067559844"),
            Map.entry("ES", "ES9021034677010000000000"),
            Map.entry("FR", "FR6410096000403534259742Y90"),
            Map.entry("GB", "GB66BUKB20267850000000"),
            Map.entry("HU", "HU42117730161111101800000000"),
            Map.entry("IE", "IE29AIBK93115212345678"),
            Map.entry("IT", "IT58A0300203280198574967934"),
            Map.entry("NL", "NL57INGB4654188101"),
            Map.entry("NO", "NO9386011117947"),
            Map.entry("RO", "RO16RZBR6343423217922456")
    );

    private static final Map<String, List<RecipientCountry>> BY_ACCOUNT_CURRENCY = Map.of(
            "EUR", SEPA_COUNTRIES.stream().sorted().map(RecipientCountries::sepaCountry).toList(),
            "GBP", List.of(new RecipientCountry("GB", "GBP", "ukLocal", "accountNumberSortCode", true,
                    Map.of("accountNumber", "50000000", "sortCode", "202678"))),
            "USD", List.of(new RecipientCountry("US", "USD", "usLocal", "accountNumberRoutingNumber", false,
                    Map.of("accountNumber", "10220001111", "routingNumber", "121000248")))
    );

    public static List<RecipientCountry> forAccountCurrency(String accountCurrency) {
        if (accountCurrency == null) {
            return List.of();
        }
        return BY_ACCOUNT_CURRENCY.getOrDefault(accountCurrency, List.of());
    }

    public static Optional<RecipientCountry> find(String accountCurrency, String countryCode) {
        return forAccountCurrency(accountCurrency).stream()
                .filter(country -> country.getCountryCode().equals(countryCode))
                .findFirst();
    }

    public static RecipientCountry require(String accountCurrency, String countryCode) {
        return find(accountCurrency, countryCode)
                .orElseThrow(() -> new BadRequestException(
                        "Transfers to " + countryCode + " are not available from a " + accountCurrency + " account"));
    }

    private static RecipientCountry sepaCountry(String countryCode) {
        boolean insideEea = !SEPA_OUTSIDE_EEA.contains(countryCode);
        Map<String, String> testAccount = TEST_IBANS.containsKey(countryCode) ? Map.of("iban", TEST_IBANS.get(countryCode)) : null;
        return new RecipientCountry(countryCode, "EUR", insideEea ? "sepaEea" : "sepaOther", "iban", insideEea, testAccount);
    }
}
