package com.myplatform.demo.dto;

import com.myplatform.demo.util.LedgerAccounts;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * The double-entry journal of a period: the invoices issued, the supplier bills received and the movements of the
 * Adyen balance accounts, matched with each other. Amounts are in minor units.
 *
 * @param movementsLoaded false when the movements couldn't be read from Adyen: the journal only has the invoices and
 *                        the bills
 * @param warnings        what the journal is missing, e.g. movements Adyen couldn't return
 * @param accounts        the chart of accounts, with one sub-account per balance account
 * @param accountTotals   the debits and credits of each account over the period
 * @param entries         the latest first
 * @param payouts         the payouts of the period, the latest first, each broken down into the movements it pays out
 * @param pending         movements of the period that aren't booked yet, so not in the journal
 */
public record LedgerDTO(LocalDate from,
                        LocalDate to,
                        String currency,
                        Instant generatedAt,
                        boolean movementsLoaded,
                        List<String> warnings,
                        Summary summary,
                        List<LedgerAccounts.Account> accounts,
                        List<AccountTotal> accountTotals,
                        List<Entry> entries,
                        List<Payout> payouts,
                        List<Pending> pending) {

    /**
     * @param journal SAL for the invoices, PUR for the supplier bills, BNK for the movements of the balance accounts
     * @param kind    INVOICE, INVOICE_VOIDED, BILL, PAYMENT, FEE, REFUND, CHARGEBACK, PAYOUT, TRANSFER, BANK_TRANSFER,
     *                CARD, FINANCING or OTHER
     * @param status  DOCUMENT for an invoice or a bill, MATCHED for a movement booked to its document, by a rule or to
     *                the category of a card payment, TO_REVIEW for a movement booked to Suspense
     * @param partner the customer, the supplier, or the counterparty of the movement: the holder of a bank account, a
     *                merchant
     * @param amount  the total of the debits
     * @param note    how the movement was matched, or why it wasn't
     */
    public record Entry(String id,
                        LocalDate date,
                        String journal,
                        String kind,
                        String status,
                        String description,
                        String partner,
                        String document,
                        Long invoiceId,
                        Long billId,
                        String transferId,
                        String pspReference,
                        String balanceAccountId,
                        String currency,
                        long amount,
                        String note,
                        List<Line> lines) {
    }

    /** @param label what the line is for, when the account doesn't say it, e.g. "VAT 20%" */
    public record Line(String account, String accountName, String label, long debit, long credit) {
    }

    /**
     * @param movements      the movements of the balance accounts in the journal
     * @param matched        the movements booked to their document or by a rule
     * @param toReview       the movements booked to Suspense
     * @param matchRate      the percentage of the movements matched automatically, null without movements
     * @param pending        the movements that aren't booked yet
     * @param balanced       every entry, and so the journal, has as many debits as credits
     */
    public record Summary(int entries,
                          int movements,
                          int matched,
                          int toReview,
                          Integer matchRate,
                          int pending,
                          boolean balanced,
                          List<Total> totals) {
    }

    public record Total(String currency, long debit, long credit) {
    }

    /** @param balance the debits minus the credits */
    public record AccountTotal(String account, String name, String currency, long debit, long credit, long balance) {
    }

    /**
     * A payout, and the movements booked on its balance account since the previous one.
     *
     * @param destination        where the funds went, e.g. "Bank account" or the Business Bank Account
     * @param amount             what was paid out
     * @param itemsTotal         the sum of the movements
     * @param difference         the amount minus the sum of the movements: the balance carried over from before the
     *                           first movement, or kept on the balance account
     * @param sincePreviousPayout false when the previous payout is older than the movements read, so the first
     *                           movements may be missing
     */
    public record Payout(String transferId,
                         LocalDate date,
                         String balanceAccountId,
                         String balanceAccount,
                         String account,
                         String destination,
                         String currency,
                         long amount,
                         List<PayoutItem> items,
                         long itemsTotal,
                         long difference,
                         boolean sincePreviousPayout) {
    }

    /** @param amount signed: positive when it credited the balance account */
    public record PayoutItem(String transferId, LocalDate date, String kind, String description, String document,
                             long amount) {
    }

    /**
     * @param amount signed: positive when it will credit the balance account
     * @param status as Adyen reports it, e.g. received, authorised or pendingApproval
     */
    public record Pending(String transferId, LocalDate date, String kind, String description, String document,
                          String currency, long amount, String status) {
    }
}
