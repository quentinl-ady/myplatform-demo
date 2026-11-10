package com.myplatform.demo.util;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * The generic chart of accounts of the journal. Each balance account is a sub-account of 1200, so that it can be
 * reconciled like a bank account.
 */
public final class LedgerAccounts {

    public record Account(String code, String name) {
    }

    public static final Account EXTERNAL_BANK = new Account("1010", "External bank");
    public static final Account RECEIVABLE = new Account("1100", "Accounts receivable");
    public static final Account VAT_RECEIVABLE = new Account("1400", "VAT receivable");
    public static final Account SUSPENSE = new Account("1900", "Suspense");
    public static final Account PAYABLE = new Account("2100", "Accounts payable");
    public static final Account VAT_PAYABLE = new Account("2200", "VAT payable");
    public static final Account FINANCING = new Account("2500", "Business financing");
    public static final Account SALES = new Account("4000", "Sales");
    public static final Account PAYMENT_FEES = new Account("6100", "Payment fees");
    public static final Account CHARGEBACKS = new Account("6150", "Chargebacks");

    private static final List<Account> STANDARD = List.of(EXTERNAL_BANK, RECEIVABLE, VAT_RECEIVABLE, SUSPENSE, PAYABLE,
            VAT_PAYABLE, FINANCING, SALES, PAYMENT_FEES, CHARGEBACKS);
    /** 1201 to 1298 are the balance accounts; 1299 groups the others. */
    private static final int MAX_SUB_ACCOUNTS = 98;

    private LedgerAccounts() {
    }

    /** The sub-account of the balance account at this position, 0 being the first: 1201, 1202... */
    public static Account balanceAccount(int index, String name) {
        if (index >= MAX_SUB_ACCOUNTS) {
            return new Account("1299", "Other balance accounts");
        }
        return new Account(String.format(Locale.ROOT, "12%02d", index + 1), "Balance account · " + name);
    }

    /** The chart in code order, with the sub-accounts of the balance accounts and the expense categories. */
    public static List<Account> chart(Collection<Account> balanceAccounts) {
        List<Account> chart = new ArrayList<>(STANDARD);
        chart.addAll(ExpenseCategories.ALL);
        balanceAccounts.stream().distinct().forEach(chart::add);
        chart.sort(Comparator.comparing(Account::code));
        return chart;
    }
}
