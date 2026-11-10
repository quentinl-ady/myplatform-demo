package com.myplatform.demo.util;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Bank details of a counterparty, in the format the transfers of an account currency take: an IBAN for EUR (SEPA),
 * an account number and sort code for GBP, an account number and routing number for USD.
 */
public final class BankDetails {

    public static final String IBAN = "iban";
    public static final String UK_LOCAL = "accountNumberSortCode";
    public static final String US_LOCAL = "accountNumberRoutingNumber";

    private static final Pattern IBAN_FORMAT = Pattern.compile("[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}");
    private static final Pattern UK_ACCOUNT_NUMBER = Pattern.compile("[0-9]{8}");
    private static final Pattern SORT_CODE = Pattern.compile("[0-9]{6}");
    private static final Pattern US_ACCOUNT_NUMBER = Pattern.compile("[0-9]{4,17}");
    private static final Pattern ROUTING_NUMBER = Pattern.compile("[0-9]{9}");
    private static final Pattern SEPARATORS = Pattern.compile("[\\s.-]+");
    private static final Pattern ACCENTS = Pattern.compile("\\p{M}+");
    // The characters the banks accept in the description of a transfer, as Adyen lists them.
    private static final Pattern NOT_SEPA = Pattern.compile("[^A-Za-z0-9/?:().,'+ -]");
    private static final Pattern NOT_US = Pattern.compile("[^A-Za-z0-9&$%#@~=+_'\"!? -]");
    private static final Pattern SPACES = Pattern.compile("\\s+");
    private static final int MAX_DESCRIPTION = 140;
    private static final String HIDDEN = "\u2022\u2022\u2022\u2022";

    private BankDetails() {
    }

    /** The value without spaces, dots or dashes, in capitals; null when blank. */
    public static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String compact = SEPARATORS.matcher(value).replaceAll("").toUpperCase(Locale.ROOT);
        return compact.isEmpty() ? null : compact;
    }

    /** The format, and the ISO 13616 check digits (mod 97). */
    public static boolean validIban(String iban) {
        if (iban == null || !IBAN_FORMAT.matcher(iban).matches()) {
            return false;
        }
        String rearranged = iban.substring(4) + iban.substring(0, 4);
        int remainder = 0;
        for (int i = 0; i < rearranged.length(); i++) {
            int value = Character.digit(rearranged.charAt(i), 36);
            remainder = (value < 10 ? remainder * 10 + value : remainder * 100 + value) % 97;
        }
        return remainder == 1;
    }

    public static boolean validUkAccountNumber(String accountNumber) {
        return accountNumber != null && UK_ACCOUNT_NUMBER.matcher(accountNumber).matches();
    }

    public static boolean validSortCode(String sortCode) {
        return sortCode != null && SORT_CODE.matcher(sortCode).matches();
    }

    public static boolean validUsAccountNumber(String accountNumber) {
        return accountNumber != null && US_ACCOUNT_NUMBER.matcher(accountNumber).matches();
    }

    /** The 9 digits, and the ABA check digit. */
    public static boolean validRoutingNumber(String routingNumber) {
        if (routingNumber == null || !ROUTING_NUMBER.matcher(routingNumber).matches()) {
            return false;
        }
        int[] weights = {3, 7, 1};
        int sum = 0;
        for (int i = 0; i < routingNumber.length(); i++) {
            sum += Character.digit(routingNumber.charAt(i), 10) * weights[i % 3];
        }
        return sum % 10 == 0;
    }

    /** The country of the bank: the one of the IBAN, else the one of the local format. */
    public static String country(String format, String iban) {
        if (format == null) {
            return null;
        }
        return switch (format) {
            case IBAN -> iban != null && iban.length() >= 2 ? iban.substring(0, 2) : null;
            case UK_LOCAL -> "GB";
            case US_LOCAL -> "US";
            default -> null;
        };
    }

    /** The account with only its last digits: FR76 •••• 9742, 20-26-78 •••• 0000 or •••• 1111. */
    public static String masked(String format, String iban, String accountNumber, String sortCode) {
        if (format == null) {
            return null;
        }
        return switch (format) {
            case IBAN -> iban == null || iban.length() < 8 ? null : iban.substring(0, 4) + " " + HIDDEN + " " + lastFour(iban);
            case UK_LOCAL -> accountNumber == null ? null
                    : (validSortCode(sortCode) ? sortCode.substring(0, 2) + "-" + sortCode.substring(2, 4) + "-"
                    + sortCode.substring(4) + " " : "") + HIDDEN + " " + lastFour(accountNumber);
            case US_LOCAL -> accountNumber == null ? null : HIDDEN + " " + lastFour(accountNumber);
            default -> null;
        };
    }

    /**
     * The description of a transfer, which most banks show to the beneficiary: without accents, the characters the
     * banks don't accept replaced by spaces, cut to the 140 characters they keep. Null when nothing is left.
     */
    public static String transferDescription(String text, String format) {
        if (text == null) {
            return null;
        }
        String plain = ACCENTS.matcher(Normalizer.normalize(text, Normalizer.Form.NFD)).replaceAll("");
        String accepted = (US_LOCAL.equals(format) ? NOT_US : NOT_SEPA).matcher(plain).replaceAll(" ");
        String cleaned = SPACES.matcher(accepted).replaceAll(" ").trim();
        if (cleaned.length() > MAX_DESCRIPTION) {
            cleaned = cleaned.substring(0, MAX_DESCRIPTION).trim();
        }
        return cleaned.isEmpty() ? null : cleaned;
    }

    private static String lastFour(String value) {
        return value.substring(Math.max(0, value.length() - 4));
    }
}
