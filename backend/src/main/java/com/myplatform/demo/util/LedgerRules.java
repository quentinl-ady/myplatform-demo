package com.myplatform.demo.util;

import com.myplatform.demo.dto.LedgerDTO;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.CardExpense;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.util.AdyenTransfers.Movement;
import com.myplatform.demo.util.LedgerAccounts.Account;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.myplatform.demo.util.LedgerAccounts.CHARGEBACKS;
import static com.myplatform.demo.util.LedgerAccounts.EXTERNAL_BANK;
import static com.myplatform.demo.util.LedgerAccounts.FINANCING;
import static com.myplatform.demo.util.LedgerAccounts.PAYABLE;
import static com.myplatform.demo.util.LedgerAccounts.PAYMENT_FEES;
import static com.myplatform.demo.util.LedgerAccounts.RECEIVABLE;
import static com.myplatform.demo.util.LedgerAccounts.SALES;
import static com.myplatform.demo.util.LedgerAccounts.SUSPENSE;
import static com.myplatform.demo.util.LedgerAccounts.VAT_PAYABLE;
import static com.myplatform.demo.util.LedgerAccounts.VAT_RECEIVABLE;

/**
 * The journal: the entries of the invoices and of the supplier bills, and those of the movements of the balance
 * accounts, matched with these documents and with the card expenses, or booked by a rule of the chart of accounts.
 * Also breaks each payout down into the movements it pays out.
 */
public final class LedgerRules {

    public static final String SALES_JOURNAL = "SAL";
    public static final String PURCHASES_JOURNAL = "PUR";
    public static final String BANK_JOURNAL = "BNK";

    public enum Kind {
        INVOICE, INVOICE_VOIDED, BILL, PAYMENT, FEE, REFUND, CHARGEBACK, PAYOUT, TRANSFER, BANK_TRANSFER, CARD, FINANCING,
        OTHER
    }

    public enum Status { DOCUMENT, MATCHED, TO_REVIEW }

    private static final Pattern INVOICE_NUMBER = Pattern.compile("INV-\\d{4}-\\d{4,}");
    private static final Pattern BILL_NUMBER = Pattern.compile("BILL-\\d{4}-\\d{4,}");
    /** The platform payment types that are costs of a payment. */
    private static final Set<String> FEE_PAYMENT_TYPES = Set.of("AcquiringFees", "AdyenCommission", "AdyenFees",
            "AdyenMarkup", "Commission", "DCCMarkup", "DCCPlatformCommission", "Interchange", "PaymentFee", "SchemeFee",
            "VAT");
    /** The fee types named after the payment provider, as the journal shows them. */
    private static final Map<String, String> PROVIDER_FEE_LABELS = Map.of("AdyenCommission", "Processing commission",
            "AdyenFees", "Processing fees", "AdyenMarkup", "Processing markup");
    /** The platform payment types that book the share of a payment that goes to the balance account. */
    private static final Set<String> SHARE_PAYMENT_TYPES = Set.of("BalanceAccount", "Default", "Remainder");
    private static final Set<String> FEE_TYPES = Set.of("fee", "paymentCost", "miscCost", "cashoutFee");
    private static final Set<String> CHARGEBACK_TYPES = Set.of("chargeback", "chargebackCorrection", "chargebackReversal",
            "chargebackReversalCorrection", "secondChargeback", "secondChargebackCorrection");
    private static final Set<String> REFUND_TYPES = Set.of("refund", "refundReversal");
    private static final Set<String> FINANCING_TYPES = Set.of("grant", "repayment", "capitalFundsCollection",
            "installment", "installmentReversal");
    /**
     * A transfer in one of these statuses, or in one that starts or ends with "pending", books the balance account later,
     * unless it fails. A captured payment, for example, is booked when Adyen settles it.
     */
    private static final Set<String> IN_FLIGHT_STATUSES = Set.of("received", "authorised", "captured");
    /** The two movements of an internal transfer are booked together: a day covers any delay between them. */
    private static final Duration TRANSFER_LEGS_GAP = Duration.ofDays(1);
    private static final Comparator<Movement> BOOKING_ORDER = Comparator.comparing(Movement::bookedAt)
            .thenComparing(Movement::createdAt, Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(Movement::id);

    private LedgerRules() {
    }

    /**
     * @param currency        the currency of the account, for the totals of an empty journal
     * @param taxLabel        what the tax is called in the country of the account, e.g. VAT or GST
     * @param bills           the supplier bills of the user
     * @param expenses        the card payments the user classified
     * @param movements       the transfers of the account holder, also those created a little before the period: they
     *                        can be booked in it, and they break its first payouts down
     * @param balanceAccounts the balance accounts of the account holder, by id
     */
    public record Input(LocalDate from, LocalDate to, String currency, String taxLabel, List<Invoice> invoices,
                        List<Bill> bills, List<CardExpense> expenses, List<Movement> movements,
                        Map<String, OwnAccount> balanceAccounts) {
    }

    /**
     * A balance account of the account holder.
     *
     * @param business the Business Bank Account, where the balance accounts that take payments are swept
     * @param account  its sub-account in the chart
     */
    public record OwnAccount(String id, String name, boolean business, Account account) {
    }

    /** The document a movement settles: an invoice or a bill. */
    private record Match(Invoice invoice, Bill bill, String by) {

        static Match of(Invoice invoice, String by) {
            return new Match(invoice, null, by);
        }

        static Match of(Bill bill, String by) {
            return new Match(null, bill, by);
        }

        String number() {
            return invoice != null ? invoice.getNumber() : bill.getNumber();
        }

        String partner() {
            return invoice != null ? invoice.getCustomer().displayName() : bill.getSupplier().getName();
        }
    }

    /**
     * How a movement is booked: against which account, and why. A transfer between own balance accounts has none.
     *
     * @param vatRate the VAT rate of a classified card payment, whose amount includes the VAT to recover; null otherwise
     */
    private record Rule(Kind kind, Account counter, Match match, BigDecimal vatRate, String description, String note) {

        Status status() {
            return SUSPENSE.equals(counter) ? Status.TO_REVIEW : Status.MATCHED;
        }

        String document() {
            return match != null ? match.number() : null;
        }
    }

    private record Posted(LedgerDTO.Entry entry, Instant at) {
    }

    private record PostedPayout(LedgerDTO.Payout payout, Instant at) {
    }

    public static LedgerDTO build(Input input, boolean movementsLoaded, List<String> warnings, Instant generatedAt) {
        Map<String, OwnAccount> own = input.balanceAccounts();
        Documents documents = new Documents(input.invoices(), input.bills(), input.expenses());
        List<Posted> posted = new ArrayList<>();
        for (Invoice invoice : input.invoices()) {
            posted.addAll(invoiceEntries(invoice, input.taxLabel()));
        }
        for (Bill bill : input.bills()) {
            posted.add(billEntry(bill, input.taxLabel()));
        }
        List<Movement> booked = input.movements().stream()
                .filter(movement -> movement.isBooked() && movement.currency() != null)
                .filter(movement -> own.containsKey(movement.balanceAccountId()))
                .sorted(BOOKING_ORDER)
                .toList();
        Map<String, LedgerDTO.Entry> entryOf = new HashMap<>();
        posted.addAll(movementEntries(booked, own, documents, input.taxLabel(), entryOf));

        List<LedgerDTO.Entry> entries = posted.stream()
                .filter(p -> inPeriod(p.entry().date(), input))
                .sorted(Comparator.comparing((Posted p) -> p.entry().date())
                        .thenComparing(Posted::at)
                        .thenComparing(p -> p.entry().id())
                        .reversed())
                .map(Posted::entry)
                .toList();
        List<LedgerDTO.Pending> pending = pending(input, own, documents);
        return new LedgerDTO(input.from(), input.to(), input.currency(), generatedAt, movementsLoaded,
                List.copyOf(warnings), summary(entries, pending.size()),
                LedgerAccounts.chart(own.values().stream().map(OwnAccount::account).toList()),
                accountTotals(entries), entries, payouts(booked, own, entryOf, input), pending);
    }

    // ---------- Sales journal ----------

    private static List<Posted> invoiceEntries(Invoice invoice, String taxLabel) {
        if (invoice.getSentAt() == null) {
            return List.of(); // never issued: a draft, or a draft that was voided
        }
        List<LedgerDTO.Line> lines = new ArrayList<>();
        lines.add(debit(RECEIVABLE, invoice.getTotal(), null));
        lines.add(credit(SALES, invoice.getSubtotal(), null));
        for (InvoiceMath.VatGroup vat : vat(invoice)) {
            if (vat.tax() != 0) {
                lines.add(credit(VAT_PAYABLE, vat.tax(), taxLabel + " " + percent(vat.rate())));
            }
        }
        LocalDate issued = invoice.getIssueDate();
        List<Posted> posted = new ArrayList<>();
        posted.add(new Posted(invoiceEntry(invoice, "SAL-" + invoice.getNumber(), issued, Kind.INVOICE,
                "Invoice " + invoice.getNumber(), lines), issued.atStartOfDay(ZoneOffset.UTC).toInstant()));
        if (invoice.getStatus() == Invoice.Status.VOID && invoice.getVoidedAt() != null) {
            List<LedgerDTO.Line> reversal = lines.stream()
                    .map(line -> new LedgerDTO.Line(line.account(), line.accountName(), line.label(), line.credit(),
                            line.debit()))
                    .toList();
            posted.add(new Posted(invoiceEntry(invoice, "SAL-" + invoice.getNumber() + "-VOID",
                    date(invoice.getVoidedAt()), Kind.INVOICE_VOIDED, "Invoice " + invoice.getNumber() + " voided",
                    reversal), invoice.getVoidedAt()));
        }
        return posted;
    }

    private static LedgerDTO.Entry invoiceEntry(Invoice invoice, String id, LocalDate date, Kind kind,
                                                String description, List<LedgerDTO.Line> lines) {
        return new LedgerDTO.Entry(id, date, SALES_JOURNAL, kind.name(), Status.DOCUMENT.name(), description,
                invoice.getCustomer().displayName(), invoice.getNumber(), invoice.getId(), null, null, null, null,
                invoice.getCurrency(), debits(lines), null, lines);
    }

    private static List<InvoiceMath.VatGroup> vat(Invoice invoice) {
        return InvoiceMath.totals(invoice.getLines().stream()
                .map(line -> new InvoiceMath.RatedAmounts(line.getVatRate(),
                        new InvoiceMath.Amounts(line.getNetAmount(), line.getTaxAmount(), line.getGrossAmount())))
                .toList()).vat();
    }

    // ---------- Purchases journal ----------

    /** A bill received: its expense and the VAT to recover, owed to the supplier. */
    private static Posted billEntry(Bill bill, String taxLabel) {
        List<LedgerDTO.Line> lines = new ArrayList<>();
        lines.add(debit(ExpenseCategories.of(bill.getCategory()), bill.getSubtotal(), null));
        if (bill.getTaxTotal() != 0) {
            lines.add(debit(VAT_RECEIVABLE, bill.getTaxTotal(), taxLabel + " " + percent(bill.getVatRate())));
        }
        lines.add(credit(PAYABLE, bill.getTotal(), null));
        LocalDate issued = bill.getIssueDate();
        String detail = bill.getDescription() != null ? bill.getDescription()
                : bill.getSupplierReference() != null ? "Invoice " + bill.getSupplierReference() : null;
        return new Posted(new LedgerDTO.Entry("PUR-" + bill.getNumber(), issued, PURCHASES_JOURNAL, Kind.BILL.name(),
                Status.DOCUMENT.name(), "Bill " + bill.getNumber() + suffix(detail), bill.getSupplier().getName(),
                bill.getNumber(), null, bill.getId(), null, null, null, bill.getCurrency(), debits(lines), null, lines),
                issued.atStartOfDay(ZoneOffset.UTC).toInstant());
    }

    // ---------- Bank journal ----------

    private static List<Posted> movementEntries(List<Movement> booked, Map<String, OwnAccount> own, Documents documents,
                                                String taxLabel, Map<String, LedgerDTO.Entry> entryOf) {
        Map<String, Rule> rules = new HashMap<>();
        Map<Long, Integer> paymentsPerInvoice = new HashMap<>();
        for (Movement movement : booked) {
            Rule rule = classify(movement, movement.booked(), own, documents);
            rules.put(movement.key(), rule);
            if (rule.kind() == Kind.PAYMENT && invoiceOf(rule) != null && movement.booked() > 0) {
                paymentsPerInvoice.merge(invoiceOf(rule).getId(), 1, Integer::sum);
            }
        }
        List<Posted> posted = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        List<Movement> transfersOut = new ArrayList<>();
        List<Movement> transfersIn = new ArrayList<>();
        for (Movement movement : booked) {
            Rule rule = rules.get(movement.key());
            if (rule.kind() == Kind.TRANSFER) {
                (movement.booked() < 0 ? transfersOut : transfersIn).add(movement);
                continue;
            }
            // An invoice paid in several movements isn't completed with what the platform withheld.
            boolean inferCommission = rule.kind() == Kind.PAYMENT && invoiceOf(rule) != null
                    && paymentsPerInvoice.getOrDefault(invoiceOf(rule).getId(), 0) == 1;
            LedgerDTO.Entry entry = movementEntry(uniqueId(movement, ids), movement, rule,
                    own.get(movement.balanceAccountId()), inferCommission, taxLabel);
            entryOf.put(movement.key(), entry);
            posted.add(new Posted(entry, movement.bookedAt()));
        }
        // An internal transfer is one entry, whether one or both of its movements are listed.
        Set<String> paired = new HashSet<>();
        for (Movement out : transfersOut) {
            LedgerDTO.Entry entry = transferEntry(uniqueId(out, ids), out, own.get(out.balanceAccountId()),
                    own.get(out.counterpartyBalanceAccountId()));
            entryOf.put(out.key(), entry);
            Movement in = counterpart(out, transfersIn, paired);
            if (in != null) {
                paired.add(in.key());
                entryOf.put(in.key(), entry);
            }
            posted.add(new Posted(entry, out.bookedAt()));
        }
        for (Movement in : transfersIn) {
            if (!paired.contains(in.key())) {
                LedgerDTO.Entry entry = transferEntry(uniqueId(in, ids), in, own.get(in.counterpartyBalanceAccountId()),
                        own.get(in.balanceAccountId()));
                entryOf.put(in.key(), entry);
                posted.add(new Posted(entry, in.bookedAt()));
            }
        }
        return posted;
    }

    private static LedgerDTO.Entry movementEntry(String id, Movement movement, Rule rule, OwnAccount account,
                                                 boolean inferCommission, String taxLabel) {
        long amount = Math.abs(movement.booked());
        Match match = rule.match();
        String note = rule.note();
        List<LedgerDTO.Line> lines = new ArrayList<>();
        if (rule.vatRate() != null) {
            lines.addAll(expenseLines(movement, rule, account, taxLabel));
        } else if (movement.booked() > 0) {
            long commission = inferCommission ? commission(movement, match.invoice()) : 0;
            lines.add(debit(account.account(), amount, null));
            if (commission > 0) {
                lines.add(debit(PAYMENT_FEES, commission, "Platform commission withheld"));
                note += " The rest of the invoice total is the commission the platform withheld.";
            }
            lines.add(credit(rule.counter(), amount + commission, null));
        } else {
            lines.add(debit(rule.counter(), amount, null));
            lines.add(credit(account.account(), amount, null));
        }
        String partner = match != null ? match.partner() : movement.counterpartyName();
        return new LedgerDTO.Entry(id, movement.bookingDate(), BANK_JOURNAL, rule.kind().name(), rule.status().name(),
                rule.description(), partner, rule.document(),
                match != null && match.invoice() != null ? match.invoice().getId() : null,
                match != null && match.bill() != null ? match.bill().getId() : null,
                movement.id(), movement.pspPaymentReference(), movement.balanceAccountId(), movement.currency(),
                debits(lines), note, lines);
    }

    /**
     * A classified card payment: its category and the VAT it includes, against the balance account of the card. A
     * refund the other way round.
     */
    private static List<LedgerDTO.Line> expenseLines(Movement movement, Rule rule, OwnAccount account, String taxLabel) {
        long amount = Math.abs(movement.booked());
        InvoiceMath.Amounts split = InvoiceMath.fromGross(amount, rule.vatRate());
        String vat = taxLabel + " " + percent(rule.vatRate());
        List<LedgerDTO.Line> lines = new ArrayList<>();
        if (movement.booked() < 0) {
            lines.add(debit(rule.counter(), split.net(), null));
            if (split.tax() != 0) {
                lines.add(debit(VAT_RECEIVABLE, split.tax(), vat));
            }
            lines.add(credit(account.account(), amount, null));
        } else {
            lines.add(debit(account.account(), amount, null));
            lines.add(credit(rule.counter(), split.net(), null));
            if (split.tax() != 0) {
                lines.add(credit(VAT_RECEIVABLE, split.tax(), vat));
            }
        }
        return lines;
    }

    /**
     * What the platform withheld from an invoice paid in full: the invoice total minus the share of the payment booked
     * on the balance account. 0 when the movement isn't that share, e.g. a tip.
     */
    private static long commission(Movement movement, Invoice invoice) {
        String paymentType = movement.platformPaymentType();
        boolean share = paymentType == null || SHARE_PAYMENT_TYPES.contains(paymentType);
        boolean payment = "capture".equals(movement.type()) || "payment".equals(movement.type());
        if (!share || !payment || !invoice.getCurrency().equals(movement.currency())
                || movement.booked() >= invoice.getTotal()) {
            return 0;
        }
        return invoice.getTotal() - movement.booked();
    }

    private static LedgerDTO.Entry transferEntry(String id, Movement movement, OwnAccount source,
                                                 OwnAccount destination) {
        long amount = Math.abs(movement.booked());
        List<LedgerDTO.Line> lines = List.of(debit(destination.account(), amount, null),
                credit(source.account(), amount, null));
        return new LedgerDTO.Entry(id, movement.bookingDate(), BANK_JOURNAL, Kind.TRANSFER.name(),
                Status.MATCHED.name(), "Transfer from " + source.name() + " to " + destination.name() + detail(movement),
                null, null, null, null, movement.id(), null, movement.balanceAccountId(), movement.currency(), amount,
                "Booked by rule: transfer between your balance accounts.", lines);
    }

    /** The incoming movement of the same internal transfer: the one with the same id, else with the same accounts and amount. */
    private static Movement counterpart(Movement out, List<Movement> incoming, Set<String> paired) {
        Movement found = null;
        for (Movement in : incoming) {
            boolean candidate = !paired.contains(in.key())
                    && in.balanceAccountId().equals(out.counterpartyBalanceAccountId())
                    && out.balanceAccountId().equals(in.counterpartyBalanceAccountId())
                    && in.booked() == -out.booked()
                    && in.currency().equals(out.currency())
                    && Duration.between(out.bookedAt(), in.bookedAt()).abs().compareTo(TRANSFER_LEGS_GAP) <= 0;
            if (candidate && in.id().equals(out.id())) {
                return in;
            }
            if (candidate && found == null) {
                found = in;
            }
        }
        return found;
    }

    private static String uniqueId(Movement movement, Set<String> ids) {
        String id = "BNK-" + movement.id();
        if (!ids.add(id)) {
            id += "-" + movement.balanceAccountId();
            ids.add(id);
        }
        return id;
    }

    private static Invoice invoiceOf(Rule rule) {
        return rule.match() != null ? rule.match().invoice() : null;
    }

    // ---------- Rules ----------

    /** @param signed the amount the movement books, or will book: positive when it credits the balance account */
    private static Rule classify(Movement movement, long signed, Map<String, OwnAccount> own, Documents documents) {
        boolean incoming = signed > 0;
        String category = Objects.toString(movement.category(), "");
        String type = Objects.toString(movement.type(), "");
        if (FEE_TYPES.contains(type)) {
            return byRule(Kind.FEE, PAYMENT_FEES, documents.invoice(movement), "Fees" + detail(movement), "fees");
        }
        if (FINANCING_TYPES.contains(type) || "grants".equals(category)) {
            return byRule(Kind.FINANCING, FINANCING, null,
                    (incoming ? "Financing funds" : "Financing repayment") + detail(movement),
                    "business financing");
        }
        return switch (category) {
            case "platformPayment" -> platformPayment(movement, type, documents);
            case "bank" -> bank(movement, incoming, documents);
            case "internal" -> internal(movement, incoming, own);
            case "issuedCard" -> card(movement, incoming, type, documents);
            case "topUp" -> byRule(Kind.BANK_TRANSFER, EXTERNAL_BANK, null, "Top-up" + detail(movement),
                    "top-ups come from your bank account");
            case "card" -> incoming
                    ? byRule(Kind.BANK_TRANSFER, EXTERNAL_BANK, null, "Transfer from a card" + detail(movement),
                    "funds from your bank account")
                    : byRule(Kind.PAYOUT, EXTERNAL_BANK, null, "Payout to a card", "payouts go to your bank account");
            default -> review(Kind.OTHER, null, (category.isEmpty() ? "Movement" : words(category)) + detail(movement),
                    "No rule books this kind of movement: booked to Suspense.");
        };
    }

    private static Rule platformPayment(Movement movement, String type, Documents documents) {
        Match match = documents.invoice(movement);
        String reference = match != null ? match.number()
                : movement.paymentMerchantReference() != null ? movement.paymentMerchantReference()
                : movement.pspPaymentReference();
        String paymentType = movement.platformPaymentType();
        if (paymentType != null && FEE_PAYMENT_TYPES.contains(paymentType)) {
            return byRule(Kind.FEE, PAYMENT_FEES, match,
                    PROVIDER_FEE_LABELS.getOrDefault(paymentType, words(paymentType)) + suffix(reference), "payment fees");
        }
        if (CHARGEBACK_TYPES.contains(type) || "ChargebackRemainder".equals(paymentType)) {
            return byRule(Kind.CHARGEBACK, CHARGEBACKS, match,
                    words(CHARGEBACK_TYPES.contains(type) ? type : "chargeback") + suffix(reference), "chargebacks");
        }
        if (REFUND_TYPES.contains(type)) {
            return byRule(Kind.REFUND, SALES, match, words(type) + suffix(reference), "refunds reduce the sales");
        }
        if (match != null) {
            return matched(Kind.PAYMENT, RECEIVABLE, match, "Payment" + suffix(reference));
        }
        return review(Kind.PAYMENT, null, "Payment" + suffix(reference),
                "No invoice matches this payment: booked to Suspense.");
    }

    private static Rule bank(Movement movement, boolean incoming, Documents documents) {
        if (movement.counterpartyTransferInstrumentId() != null) {
            return incoming
                    ? byRule(Kind.BANK_TRANSFER, EXTERNAL_BANK, null, "Transfer from your bank account",
                    "funds from your bank account")
                    : byRule(Kind.PAYOUT, EXTERNAL_BANK, null, "Payout to your bank account",
                    "payouts go to your bank account");
        }
        String party = movement.counterpartyName() != null ? movement.counterpartyName() : "a bank account";
        if (incoming) {
            Match match = documents.invoiceByNumber(movement);
            return match != null
                    ? matched(Kind.BANK_TRANSFER, RECEIVABLE, match, "Transfer from " + party + suffix(match.number()))
                    : review(Kind.BANK_TRANSFER, null, "Transfer from " + party + detail(movement),
                    "No invoice number in the transfer reference: booked to Suspense.");
        }
        Match bill = documents.billPaidBy(movement);
        return bill != null
                ? matched(Kind.BANK_TRANSFER, PAYABLE, bill, "Transfer to " + party + suffix(bill.number()))
                : review(Kind.BANK_TRANSFER, null, "Transfer to " + party + detail(movement),
                "No supplier bill matches this transfer: booked to Suspense.");
    }

    private static Rule internal(Movement movement, boolean incoming, Map<String, OwnAccount> own) {
        String counterparty = movement.counterpartyBalanceAccountId();
        OwnAccount self = own.get(movement.balanceAccountId());
        OwnAccount other = counterparty != null && !counterparty.equals(movement.balanceAccountId())
                ? own.get(counterparty) : null;
        if (self != null && other != null) {
            OwnAccount source = incoming ? other : self;
            OwnAccount destination = incoming ? self : other;
            return byRule(Kind.TRANSFER, null, null,
                    "Transfer from " + source.name() + " to " + destination.name() + detail(movement),
                    "transfer between your balance accounts");
        }
        String party = counterparty != null ? "balance account " + counterparty : "another balance account";
        return review(Kind.OTHER, null, (incoming ? "Transfer from " : "Transfer to ") + party + detail(movement),
                "The counterparty isn't one of your balance accounts: booked to Suspense.");
    }

    /**
     * A payment with the single-use card of a bill pays the bill; another one is booked to the category the user
     * classified it in, else to Suspense.
     */
    private static Rule card(Movement movement, boolean incoming, String type, Documents documents) {
        String what = "atmWithdrawal".equals(type) ? "Cash withdrawal" : incoming ? "Card refund" : "Card payment";
        String description = what + suffix(movement.counterpartyName());
        Match bill = documents.billOfCard(movement);
        if (bill != null) {
            return matched(Kind.CARD, PAYABLE, bill, description + suffix(bill.number()));
        }
        CardExpense expense = documents.expense(movement);
        if (expense != null) {
            Account category = ExpenseCategories.of(expense.getCategory());
            boolean receiptMissing = !incoming && expense.getReceiptName() == null;
            return new Rule(Kind.CARD, category, null, expense.getVatRate(), description,
                    "Booked to " + category.code() + " " + category.name() + ", as classified on the card payment."
                            + (receiptMissing ? " Receipt missing." : ""));
        }
        return review(Kind.CARD, null, description, "The card spend has no expense category yet: booked to Suspense.");
    }

    private static Rule byRule(Kind kind, Account counter, Match match, String description, String rule) {
        return new Rule(kind, counter, match, null, description, "Booked by rule: " + rule
                + (match != null ? ", for " + match.number() : "") + ".");
    }

    private static Rule matched(Kind kind, Account counter, Match match, String description) {
        return new Rule(kind, counter, match, null, description,
                "Matched to " + match.number() + " by " + match.by() + ".");
    }

    private static Rule review(Kind kind, Match match, String description, String note) {
        return new Rule(kind, SUSPENSE, match, null, description, note);
    }

    // ---------- Pending movements ----------

    private static List<LedgerDTO.Pending> pending(Input input, Map<String, OwnAccount> own, Documents documents) {
        List<LedgerDTO.Pending> pending = new ArrayList<>();
        input.movements().stream()
                .filter(movement -> !movement.isBooked() && inFlight(movement.status()))
                .filter(movement -> own.containsKey(movement.balanceAccountId()) && movement.createdAt() != null
                        && inPeriod(date(movement.createdAt()), input))
                .sorted(Comparator.comparing(Movement::createdAt).reversed())
                .forEach(movement -> {
                    Rule rule = classify(movement, movement.amount(), own, documents);
                    // A transfer between own balance accounts is listed once, with its outgoing movement.
                    if (rule.kind() != Kind.TRANSFER || movement.amount() < 0) {
                        pending.add(new LedgerDTO.Pending(movement.id(), date(movement.createdAt()), rule.kind().name(),
                                rule.description(), rule.document(), movement.currency(), movement.amount(),
                                movement.status()));
                    }
                });
        return pending;
    }

    private static boolean inFlight(String status) {
        return status != null && (IN_FLIGHT_STATUSES.contains(status) || status.startsWith("pending")
                || status.endsWith("Pending"));
    }

    // ---------- Payouts ----------

    /**
     * The payouts of the period, to your bank account or a sweep to the Business Bank Account, each broken down into
     * the movements booked on its balance account since the previous payout.
     */
    private static List<LedgerDTO.Payout> payouts(List<Movement> booked, Map<String, OwnAccount> own,
                                                  Map<String, LedgerDTO.Entry> entryOf, Input input) {
        Map<String, List<Movement>> byAccount = new LinkedHashMap<>();
        for (Movement movement : booked) {
            byAccount.computeIfAbsent(movement.balanceAccountId(), id -> new ArrayList<>()).add(movement);
        }
        List<PostedPayout> payouts = new ArrayList<>();
        byAccount.forEach((accountId, movements) -> {
            OwnAccount account = own.get(accountId);
            int start = 0;
            for (int i = 0; i < movements.size(); i++) {
                Movement movement = movements.get(i);
                String destination = payoutDestination(movement, entryOf.get(movement.key()), own);
                if (destination == null) {
                    continue;
                }
                if (inPeriod(movement.bookingDate(), input)) {
                    List<LedgerDTO.PayoutItem> items = movements.subList(start, i).stream()
                            .filter(item -> item.currency().equals(movement.currency()))
                            .map(item -> payoutItem(item, entryOf.get(item.key())))
                            .toList();
                    long itemsTotal = items.stream().mapToLong(LedgerDTO.PayoutItem::amount).sum();
                    long amount = -movement.booked();
                    payouts.add(new PostedPayout(new LedgerDTO.Payout(movement.id(), movement.bookingDate(), accountId,
                            account.name(), account.account().code(), destination, movement.currency(), amount, items,
                            itemsTotal, amount - itemsTotal, start > 0), movement.bookedAt()));
                }
                start = i + 1;
            }
        });
        return payouts.stream()
                .sorted(Comparator.comparing(PostedPayout::at).reversed())
                .map(PostedPayout::payout)
                .toList();
    }

    /** Where a payout went, null when the movement isn't a payout. */
    private static String payoutDestination(Movement movement, LedgerDTO.Entry entry, Map<String, OwnAccount> own) {
        if (movement.booked() >= 0 || entry == null) {
            return null;
        }
        if (Kind.PAYOUT.name().equals(entry.kind())) {
            String destination = "card".equals(movement.category()) ? "Card" : "Bank account";
            return destination + suffix(movement.counterpartyName());
        }
        String counterparty = movement.counterpartyBalanceAccountId();
        if (Kind.TRANSFER.name().equals(entry.kind()) && counterparty != null) {
            OwnAccount source = own.get(movement.balanceAccountId());
            OwnAccount destination = own.get(counterparty);
            if (destination != null && destination.business() && !source.business()) {
                return destination.name();
            }
        }
        return null;
    }

    private static LedgerDTO.PayoutItem payoutItem(Movement movement, LedgerDTO.Entry entry) {
        return new LedgerDTO.PayoutItem(movement.id(), movement.bookingDate(), entry.kind(), entry.description(),
                entry.document(), movement.booked());
    }

    // ---------- Totals ----------

    private static LedgerDTO.Summary summary(List<LedgerDTO.Entry> entries, int pending) {
        int movements = 0;
        int toReview = 0;
        boolean balanced = true;
        Map<String, long[]> totals = new TreeMap<>();
        for (LedgerDTO.Entry entry : entries) {
            if (BANK_JOURNAL.equals(entry.journal())) {
                movements++;
                if (Status.TO_REVIEW.name().equals(entry.status())) {
                    toReview++;
                }
            }
            long debit = 0;
            long credit = 0;
            for (LedgerDTO.Line line : entry.lines()) {
                debit += line.debit();
                credit += line.credit();
            }
            balanced &= debit == credit;
            long[] total = totals.computeIfAbsent(entry.currency(), currency -> new long[2]);
            total[0] += debit;
            total[1] += credit;
        }
        int matched = movements - toReview;
        Integer matchRate = movements == 0 ? null : (int) (matched * 100L / movements);
        List<LedgerDTO.Total> currencyTotals = totals.entrySet().stream()
                .map(total -> new LedgerDTO.Total(total.getKey(), total.getValue()[0], total.getValue()[1]))
                .toList();
        return new LedgerDTO.Summary(entries.size(), movements, matched, toReview, matchRate, pending, balanced,
                currencyTotals);
    }

    private static List<LedgerDTO.AccountTotal> accountTotals(List<LedgerDTO.Entry> entries) {
        Map<String, LedgerDTO.AccountTotal> totals = new TreeMap<>();
        for (LedgerDTO.Entry entry : entries) {
            for (LedgerDTO.Line line : entry.lines()) {
                totals.merge(line.account() + "|" + entry.currency(),
                        new LedgerDTO.AccountTotal(line.account(), line.accountName(), entry.currency(), line.debit(),
                                line.credit(), line.debit() - line.credit()),
                        (total, more) -> new LedgerDTO.AccountTotal(total.account(), total.name(), total.currency(),
                                total.debit() + more.debit(), total.credit() + more.credit(),
                                total.balance() + more.balance()));
            }
        }
        return new ArrayList<>(totals.values());
    }

    // ---------- Helpers ----------

    /**
     * The documents the movements are matched with: the issued invoices, by number and by the PSP reference of their
     * payment; the bills, by their transfer, their number and their single-use card; the card expenses, by transfer.
     */
    private static final class Documents {

        private final Map<String, Invoice> invoicesByNumber = new HashMap<>();
        private final Map<String, Invoice> invoicesByPspReference = new HashMap<>();
        private final Map<String, Bill> billsByNumber = new HashMap<>();
        private final Map<String, Bill> billsByTransfer = new HashMap<>();
        private final Map<String, Bill> billsByCard = new HashMap<>();
        private final Map<String, CardExpense> expensesByTransfer = new HashMap<>();

        Documents(List<Invoice> invoices, List<Bill> bills, List<CardExpense> expenses) {
            for (Invoice invoice : invoices) {
                if (invoice.getSentAt() == null) {
                    continue; // a draft can't be paid
                }
                invoicesByNumber.putIfAbsent(invoice.getNumber(), invoice);
                if (invoice.getPspReference() != null) {
                    invoicesByPspReference.putIfAbsent(invoice.getPspReference(), invoice);
                }
            }
            for (Bill bill : bills) {
                billsByNumber.putIfAbsent(bill.getNumber(), bill);
                if (bill.getTransferId() != null) {
                    billsByTransfer.putIfAbsent(bill.getTransferId(), bill);
                }
                if (bill.getPaymentInstrumentId() != null) {
                    billsByCard.putIfAbsent(bill.getPaymentInstrumentId(), bill);
                }
            }
            for (CardExpense expense : expenses) {
                expensesByTransfer.putIfAbsent(expense.getTransferId(), expense);
            }
        }

        /** The invoice a payment settles: by the PSP reference of the payment, else by its number in a reference. */
        Match invoice(Movement movement) {
            Invoice invoice = movement.pspPaymentReference() != null
                    ? invoicesByPspReference.get(movement.pspPaymentReference()) : null;
            return invoice != null ? Match.of(invoice, "its PSP reference") : invoiceByNumber(movement);
        }

        Match invoiceByNumber(Movement movement) {
            Invoice invoice = find(INVOICE_NUMBER, invoicesByNumber, movement.paymentMerchantReference(),
                    movement.modificationMerchantReference(), movement.reference(), movement.referenceForBeneficiary(),
                    movement.description());
            return invoice != null ? Match.of(invoice, "the invoice number in its reference") : null;
        }

        /** The bill a transfer to a bank account pays: the bill paid with it, else the one its reference names. */
        Match billPaidBy(Movement movement) {
            Bill bill = billsByTransfer.get(movement.id());
            if (bill != null) {
                return Match.of(bill, "its transfer");
            }
            bill = find(BILL_NUMBER, billsByNumber, movement.reference(), movement.referenceForBeneficiary(),
                    movement.description());
            return bill != null ? Match.of(bill, "the bill number in its reference") : null;
        }

        /** The bill the single-use card of a card payment pays. */
        Match billOfCard(Movement movement) {
            Bill bill = movement.paymentInstrumentId() != null ? billsByCard.get(movement.paymentInstrumentId()) : null;
            if (bill == null && billsByTransfer.get(movement.id()) != null
                    && billsByTransfer.get(movement.id()).getPaymentMethod() == Bill.PaymentMethod.CARD) {
                bill = billsByTransfer.get(movement.id());
            }
            return bill != null ? Match.of(bill, "its single-use card") : null;
        }

        CardExpense expense(Movement movement) {
            return expensesByTransfer.get(movement.id());
        }

        /** The first document whose number one of the texts has. */
        private static <T> T find(Pattern number, Map<String, T> byNumber, String... texts) {
            for (String text : texts) {
                if (text == null) {
                    continue;
                }
                Matcher matcher = number.matcher(text);
                while (matcher.find()) {
                    T document = byNumber.get(matcher.group());
                    if (document != null) {
                        return document;
                    }
                }
            }
            return null;
        }
    }

    private static LedgerDTO.Line debit(Account account, long amount, String label) {
        return new LedgerDTO.Line(account.code(), account.name(), label, amount, 0);
    }

    private static LedgerDTO.Line credit(Account account, long amount, String label) {
        return new LedgerDTO.Line(account.code(), account.name(), label, 0, amount);
    }

    private static long debits(List<LedgerDTO.Line> lines) {
        return lines.stream().mapToLong(LedgerDTO.Line::debit).sum();
    }

    private static boolean inPeriod(LocalDate date, Input input) {
        return !date.isBefore(input.from()) && !date.isAfter(input.to());
    }

    private static LocalDate date(Instant instant) {
        return instant.atZone(ZoneOffset.UTC).toLocalDate();
    }

    private static String percent(BigDecimal rate) {
        return rate.stripTrailingZeros().toPlainString() + "%";
    }

    /** The description of a movement, else its reference, to append to what the movement is. */
    private static String detail(Movement movement) {
        return suffix(movement.description() != null ? movement.description() : movement.reference());
    }

    private static String suffix(String value) {
        return value != null && !value.isBlank() ? " · " + value : "";
    }

    /** "chargebackReversal" becomes "Chargeback reversal", "DCCMarkup" "DCC markup". */
    static String words(String camelCase) {
        if (camelCase.isBlank()) {
            return camelCase;
        }
        StringBuilder words = new StringBuilder();
        for (String part : camelCase.split("(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")) {
            boolean acronym = part.length() > 1 && part.equals(part.toUpperCase(Locale.ROOT));
            String word = acronym ? part : part.toLowerCase(Locale.ROOT);
            if (words.isEmpty()) {
                words.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
            } else {
                words.append(' ').append(word);
            }
        }
        return words.toString();
    }
}
