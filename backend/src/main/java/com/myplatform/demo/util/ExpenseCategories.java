package com.myplatform.demo.util;

import com.myplatform.demo.util.LedgerAccounts.Account;

import java.util.List;
import java.util.Optional;

/**
 * The expense accounts (62xx) supplier bills and card spend are booked to. A card payment suggests one from the
 * merchant category code (MCC) of the merchant.
 */
public final class ExpenseCategories {

    public static final Account RENT = new Account("6200", "Rent and utilities");
    public static final Account SOFTWARE = new Account("6210", "Software and subscriptions");
    public static final Account OFFICE = new Account("6220", "Office supplies and equipment");
    public static final Account TRAVEL = new Account("6230", "Travel and transport");
    public static final Account MEALS = new Account("6240", "Meals and entertainment");
    public static final Account MARKETING = new Account("6250", "Marketing and advertising");
    public static final Account PROFESSIONAL_FEES = new Account("6260", "Professional fees");
    public static final Account TELECOM = new Account("6270", "Telecom and internet");
    public static final Account SHIPPING = new Account("6280", "Shipping and delivery");
    public static final Account OTHER = new Account("6290", "Other expenses");

    public static final List<Account> ALL = List.of(RENT, SOFTWARE, OFFICE, TRAVEL, MEALS, MARKETING, PROFESSIONAL_FEES,
            TELECOM, SHIPPING, OTHER);

    private ExpenseCategories() {
    }

    public static Optional<Account> find(String code) {
        return ALL.stream().filter(account -> account.code().equals(code)).findFirst();
    }

    /** The category of the account code, Other expenses for an unknown one. */
    public static Account of(String code) {
        return find(code).orElse(OTHER);
    }

    /** The category the merchant category code of a card payment suggests, Other expenses when it suggests none. */
    public static Account forMcc(String mcc) {
        int code;
        try {
            code = Integer.parseInt(mcc == null ? "" : mcc.trim());
        } catch (NumberFormatException e) {
            return OTHER;
        }
        // The airlines, car rental agencies and hotels each have their own code between 3000 and 3999.
        if (code >= 3000 && code <= 3999) {
            return TRAVEL;
        }
        return switch (code) {
            case 4111, 4112, 4121, 4131, 4411, 4511, 4722, 4784, 5541, 5542, 7011, 7512, 7523 -> TRAVEL;
            case 5811, 5812, 5813, 5814 -> MEALS;
            case 5734, 5817, 5818, 7372, 7379 -> SOFTWARE;
            case 5044, 5045, 5111, 5732, 5943, 5978 -> OFFICE;
            case 7311, 7333 -> MARKETING;
            case 7392, 8111, 8931, 8999 -> PROFESSIONAL_FEES;
            case 4814, 4816, 4899 -> TELECOM;
            case 4214, 4215, 9402 -> SHIPPING;
            case 4900, 6513 -> RENT;
            default -> OTHER;
        };
    }
}
