package com.myplatform.demo.util;

import java.util.Locale;
import java.util.Map;

/** Readable names of the payment methods Adyen reports in webhooks, e.g. "mc" or "visa_applepay". */
public final class PaymentMethodNames {

    private static final Map<String, String> NAMES = Map.ofEntries(
            Map.entry("amex", "American Express"),
            Map.entry("applepay", "Apple Pay"),
            Map.entry("bcmc", "Bancontact"),
            Map.entry("cartebancaire", "Cartes Bancaires"),
            Map.entry("googlepay", "Google Pay"),
            Map.entry("ideal", "iDEAL"),
            Map.entry("klarna", "Klarna"),
            Map.entry("klarna_b2b", "Billie"),
            Map.entry("maestro", "Maestro"),
            Map.entry("mc", "Mastercard"),
            Map.entry("paypal", "PayPal"),
            Map.entry("paywithgoogle", "Google Pay"),
            Map.entry("sepadirectdebit", "SEPA Direct Debit"),
            Map.entry("trustly", "Trustly"),
            Map.entry("twint", "TWINT"),
            Map.entry("visa", "Visa"));

    private PaymentMethodNames() {
    }

    public static String of(String paymentMethod) {
        if (paymentMethod == null || paymentMethod.isBlank()) {
            return null;
        }
        String key = paymentMethod.toLowerCase(Locale.ROOT);
        String name = NAMES.get(key);
        if (name != null) {
            return name;
        }
        // A card in a wallet: visa_applepay, mc_googlepay...
        int underscore = key.indexOf('_');
        if (underscore > 0) {
            String card = NAMES.get(key.substring(0, underscore));
            String wallet = NAMES.get(key.substring(underscore + 1));
            if (card != null && wallet != null) {
                return card + " (" + wallet + ")";
            }
        }
        return paymentMethod;
    }
}
