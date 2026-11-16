package com.myplatform.demo.util;

import com.myplatform.demo.dto.LedgerDTO;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.CardExpense;
import com.myplatform.demo.model.Customer;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.InvoiceLine;
import com.myplatform.demo.model.Supplier;
import com.myplatform.demo.util.AdyenTransfers.Movement;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class LedgerRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 9);
    private static final Instant NOW = TODAY.atTime(12, 0).toInstant(ZoneOffset.UTC);
    private static final String MAIN = "BA_MAIN";
    private static final String BUSINESS = "BA_BUSINESS";

    @Test
    void anIssuedInvoiceDebitsTheReceivablesAndCreditsTheSalesAndTheVatOfEachRate() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(2, 50_000, "20"), line(3, 333, "5.5"));

        LedgerDTO ledger = ledger(List.of(invoice), List.of());

        LedgerDTO.Entry entry = single(ledger.entries());
        assertThat(entry.journal()).isEqualTo("SAL");
        assertThat(entry.status()).isEqualTo("DOCUMENT");
        assertThat(entry.partner()).isEqualTo("Acme");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::label, LedgerDTO.Line::debit,
                LedgerDTO.Line::credit).containsExactly(
                tuple("1100", null, 120_000L + 999 + 55, 0L),
                tuple("4000", null, 0L, 100_000L + 999),
                tuple("2200", "VAT 20%", 0L, 20_000L),
                tuple("2200", "VAT 5.5%", 0L, 55L));
        assertThat(ledger.summary().balanced()).isTrue();
        assertThat(ledger.summary().movements()).isZero();
        assertThat(ledger.summary().matchRate()).isNull();
    }

    @Test
    void aDraftIsNotJournaled() {
        Invoice draft = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        draft.setStatus(Invoice.Status.DRAFT);
        draft.setSentAt(null);

        assertThat(ledger(List.of(draft), List.of()).entries()).isEmpty();
    }

    @Test
    void aVoidedInvoiceIsReversed() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        invoice.setStatus(Invoice.Status.VOID);
        invoice.setVoidedAt(NOW.minusSeconds(3600));

        List<LedgerDTO.Entry> entries = ledger(List.of(invoice), List.of()).entries();

        assertThat(entries).extracting(LedgerDTO.Entry::kind).containsExactly("INVOICE_VOIDED", "INVOICE");
        assertThat(entries.get(0).lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit,
                LedgerDTO.Line::credit).containsExactly(
                tuple("1100", 0L, 12_000L), tuple("4000", 10_000L, 0L), tuple("2200", 2_000L, 0L));
    }

    @Test
    void aPaymentMatchedByItsPspReferenceSettlesTheInvoiceAndBooksTheCommissionWithheld() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(1, 100_000, "20"));
        invoice.setPspReference("PSP1");
        Movement payment = transfer("T1").payment(108_000).psp("PSP1").build();

        LedgerDTO ledger = ledger(List.of(invoice), List.of(payment));

        LedgerDTO.Entry entry = ledger.entries().get(0);
        assertThat(entry.kind()).isEqualTo("PAYMENT");
        assertThat(entry.status()).isEqualTo("MATCHED");
        assertThat(entry.document()).isEqualTo("INV-2026-0001");
        assertThat(entry.invoiceId()).isEqualTo(1L);
        assertThat(entry.note()).startsWith("Matched to INV-2026-0001 by its PSP reference.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("1201", 108_000L, 0L), tuple("6100", 12_000L, 0L), tuple("1100", 0L, 120_000L));
        assertThat(ledger.summary().matchRate()).isEqualTo(100);
        assertThat(ledger.summary().balanced()).isTrue();
    }

    @Test
    void aPaymentIsMatchedByTheInvoiceNumberInItsReference() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        Movement payment = transfer("T1").payment(12_000).paymentReference("INV-2026-0001").build();

        LedgerDTO.Entry entry = ledger(List.of(invoice), List.of(payment)).entries().get(0);

        assertThat(entry.document()).isEqualTo("INV-2026-0001");
        assertThat(entry.note()).isEqualTo("Matched to INV-2026-0001 by the invoice number in its reference.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("1201", 12_000L, 0L), tuple("1100", 0L, 12_000L));
    }

    @Test
    void aPaymentWithoutInvoiceIsBookedToSuspense() {
        Movement payment = transfer("T1").payment(5_000).paymentReference("order-42").build();

        LedgerDTO ledger = ledger(List.of(), List.of(payment));

        LedgerDTO.Entry entry = single(ledger.entries());
        assertThat(entry.status()).isEqualTo("TO_REVIEW");
        assertThat(entry.description()).isEqualTo("Payment · order-42");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account).containsExactly("1201", "1900");
        assertThat(ledger.summary().toReview()).isEqualTo(1);
        assertThat(ledger.summary().matchRate()).isZero();
    }

    @Test
    void feesRefundsAndChargebacksAreBookedByRule() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        invoice.setPspReference("PSP1");
        List<Movement> movements = List.of(
                transfer("FEE").booked(-150).paymentType("PaymentFee").psp("PSP1").at(NOW.minusSeconds(300)).build(),
                transfer("REFUND").booked(-2_000).type("refund").psp("PSP1").at(NOW.minusSeconds(200)).build(),
                transfer("CB").booked(-3_000).type("chargeback").psp("PSP1").at(NOW.minusSeconds(100)).build());

        List<LedgerDTO.Entry> entries = ledger(List.of(invoice), movements).entries();

        assertThat(entries).extracting(LedgerDTO.Entry::kind, LedgerDTO.Entry::status, LedgerDTO.Entry::document)
                .containsExactly(
                        tuple("CHARGEBACK", "MATCHED", "INV-2026-0001"),
                        tuple("REFUND", "MATCHED", "INV-2026-0001"),
                        tuple("FEE", "MATCHED", "INV-2026-0001"),
                        tuple("INVOICE", "DOCUMENT", "INV-2026-0001"));
        assertThat(entries.subList(0, 3)).extracting(entry -> entry.lines().get(0).account())
                .containsExactly("6150", "4000", "6100");
        assertThat(entries.get(2).note()).isEqualTo("Booked by rule: payment fees, for INV-2026-0001.");
    }

    @Test
    void aPayoutToTheBankAccountDebitsTheExternalBank() {
        Movement payout = transfer("P1").bank().booked(-9_500).transferInstrument("SE_1").build();

        LedgerDTO.Entry entry = single(ledger(List.of(), List.of(payout)).entries());

        assertThat(entry.kind()).isEqualTo("PAYOUT");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("1010", 9_500L, 0L), tuple("1201", 0L, 9_500L));
    }

    @Test
    void anIncomingBankTransferIsMatchedByTheInvoiceNumber() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        Movement transfer = transfer("B1").bank().booked(12_000).counterpartyName("Acme Ltd")
                .description("Payment of invoice INV-2026-0001").build();

        LedgerDTO.Entry entry = ledger(List.of(invoice), List.of(transfer)).entries().get(0);

        assertThat(entry.kind()).isEqualTo("BANK_TRANSFER");
        assertThat(entry.status()).isEqualTo("MATCHED");
        assertThat(entry.partner()).isEqualTo("Acme");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account).containsExactly("1201", "1100");
    }

    @Test
    void anInternalTransferBetweenOwnBalanceAccountsIsOneEntry() {
        List<Movement> movements = List.of(
                transfer("T1").internal(BUSINESS).booked(-1_000).build(),
                transfer("T1").account(BUSINESS).internal(MAIN).booked(1_000).build());

        LedgerDTO ledger = ledger(List.of(), movements);

        LedgerDTO.Entry entry = single(ledger.entries());
        assertThat(entry.kind()).isEqualTo("TRANSFER");
        assertThat(entry.description()).isEqualTo("Transfer from Main Balance Account to Business Bank Account");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("1202", 1_000L, 0L), tuple("1201", 0L, 1_000L));
    }

    @Test
    void aPayoutIsBrokenDownIntoTheMovementsSinceThePreviousOne() {
        List<Movement> movements = List.of(
                transfer("PAY1").payment(10_000).at(NOW.minusSeconds(5 * 3600)).build(),
                transfer("FEE1").booked(-500).paymentType("PaymentFee").at(NOW.minusSeconds(4 * 3600)).build(),
                transfer("OUT1").bank().booked(-9_500).transferInstrument("SE_1").at(NOW.minusSeconds(3 * 3600)).build(),
                transfer("PAY2").payment(5_000).at(NOW.minusSeconds(2 * 3600)).build(),
                transfer("OUT2").bank().booked(-4_000).transferInstrument("SE_1").at(NOW.minusSeconds(3600)).build());

        List<LedgerDTO.Payout> payouts = ledger(List.of(), movements).payouts();

        assertThat(payouts).extracting(LedgerDTO.Payout::transferId, LedgerDTO.Payout::amount,
                        LedgerDTO.Payout::itemsTotal, LedgerDTO.Payout::difference, LedgerDTO.Payout::sincePreviousPayout)
                .containsExactly(
                        tuple("OUT2", 4_000L, 5_000L, -1_000L, true),
                        tuple("OUT1", 9_500L, 9_500L, 0L, false));
        assertThat(payouts.get(1).items()).extracting(LedgerDTO.PayoutItem::transferId, LedgerDTO.PayoutItem::amount)
                .containsExactly(tuple("PAY1", 10_000L), tuple("FEE1", -500L));
        assertThat(payouts.get(1).destination()).isEqualTo("Bank account");
    }

    @Test
    void aSweepToTheBusinessBankAccountIsAPayout() {
        List<Movement> movements = List.of(
                transfer("PAY1").payment(1_000).at(NOW.minusSeconds(600)).build(),
                transfer("SWEEP").internal(BUSINESS).booked(-1_000).at(NOW.minusSeconds(300)).build(),
                transfer("SWEEP").account(BUSINESS).internal(MAIN).booked(1_000).at(NOW.minusSeconds(300)).build());

        LedgerDTO.Payout payout = single(ledger(List.of(), movements).payouts());

        assertThat(payout.destination()).isEqualTo("Business Bank Account");
        assertThat(payout.account()).isEqualTo("1201");
        assertThat(payout.difference()).isZero();
    }

    @Test
    void movementsNotBookedYetArePendingNotJournaled() {
        Invoice invoice = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        Movement received = transfer("T1").payment(0).amount(12_000).status("received")
                .paymentReference("INV-2026-0001").build();
        Movement captured = transfer("T2").payment(0).amount(5_000).status("captured").at(NOW.minusSeconds(30)).build();
        Movement refused = transfer("T3").payment(0).amount(7_000).status("refused").build();

        LedgerDTO ledger = ledger(List.of(invoice), List.of(received, captured, refused));

        assertThat(ledger.entries()).extracting(LedgerDTO.Entry::kind).containsExactly("INVOICE");
        assertThat(ledger.pending()).extracting(LedgerDTO.Pending::transferId, LedgerDTO.Pending::document,
                        LedgerDTO.Pending::amount, LedgerDTO.Pending::status)
                .containsExactly(tuple("T2", null, 5_000L, "captured"), tuple("T1", "INV-2026-0001", 12_000L, "received"));
        assertThat(ledger.summary().pending()).isEqualTo(2);
    }

    @Test
    void entriesOutsideThePeriodAreLeftOut() {
        Invoice old = invoice(1, "INV-2026-0001", line(1, 10_000, "20"));
        old.setIssueDate(TODAY.minusDays(45));
        Movement oldPayment = transfer("T1").payment(1_000).at(NOW.minusSeconds(40L * 86_400)).build();

        assertThat(ledger(List.of(old), List.of(oldPayment)).entries()).isEmpty();
    }

    @Test
    void aBillDebitsItsCategoryAndTheVatToRecoverAndCreditsThePayables() {
        Bill bill = bill(7, "BILL-2026-0001", 10_000, "20", "6250");

        LedgerDTO ledger = ledger(List.of(), List.of(bill), List.of(), List.of());

        LedgerDTO.Entry entry = single(ledger.entries());
        assertThat(entry.id()).isEqualTo("PUR-BILL-2026-0001");
        assertThat(entry.journal()).isEqualTo("PUR");
        assertThat(entry.kind()).isEqualTo("BILL");
        assertThat(entry.status()).isEqualTo("DOCUMENT");
        assertThat(entry.partner()).isEqualTo("BrightPixel Marketing");
        assertThat(entry.description()).isEqualTo("Bill BILL-2026-0001 · Invoice F-1042");
        assertThat(entry.document()).isEqualTo("BILL-2026-0001");
        assertThat(entry.billId()).isEqualTo(7L);
        assertThat(entry.invoiceId()).isNull();
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::label, LedgerDTO.Line::debit,
                LedgerDTO.Line::credit).containsExactly(
                tuple("6250", null, 10_000L, 0L),
                tuple("1400", "VAT 20%", 2_000L, 0L),
                tuple("2100", null, 0L, 12_000L));
        assertThat(ledger.summary().balanced()).isTrue();
        assertThat(ledger.summary().movements()).isZero();
    }

    @Test
    void aBillWithoutVatHasNoVatLine() {
        Bill bill = bill(7, "BILL-2026-0001", 10_000, "0", "6200");

        LedgerDTO.Entry entry = single(ledger(List.of(), List.of(bill), List.of(), List.of()).entries());

        assertThat(entry.lines()).extracting(LedgerDTO.Line::account).containsExactly("6200", "2100");
    }

    @Test
    void aTransferToASupplierSettlesTheBillItPays() {
        Bill bill = bill(7, "BILL-2026-0001", 10_000, "20", "6250");
        bill.setTransferId("BT1");
        Movement transfer = transfer("BT1").bank().booked(-12_000).counterpartyName("BrightPixel Marketing Ltd").build();

        LedgerDTO ledger = ledger(List.of(), List.of(bill), List.of(), List.of(transfer));

        LedgerDTO.Entry entry = ledger.entries().get(0);
        assertThat(entry.journal()).isEqualTo("BNK");
        assertThat(entry.kind()).isEqualTo("BANK_TRANSFER");
        assertThat(entry.status()).isEqualTo("MATCHED");
        assertThat(entry.description()).isEqualTo("Transfer to BrightPixel Marketing Ltd · BILL-2026-0001");
        assertThat(entry.partner()).isEqualTo("BrightPixel Marketing");
        assertThat(entry.document()).isEqualTo("BILL-2026-0001");
        assertThat(entry.billId()).isEqualTo(7L);
        assertThat(entry.note()).isEqualTo("Matched to BILL-2026-0001 by its transfer.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("2100", 12_000L, 0L), tuple("1201", 0L, 12_000L));
        assertThat(ledger.summary().matchRate()).isEqualTo(100);
        assertThat(ledger.summary().balanced()).isTrue();
    }

    @Test
    void aTransferToASupplierIsMatchedByTheBillNumberInItsReference() {
        Bill bill = bill(7, "BILL-2026-0001", 10_000, "20", "6250");
        Movement transfer = transfer("BT1").bank().booked(-12_000).reference("BILL-2026-0001").build();

        LedgerDTO.Entry entry = ledger(List.of(), List.of(bill), List.of(), List.of(transfer)).entries().get(0);

        assertThat(entry.note()).isEqualTo("Matched to BILL-2026-0001 by the bill number in its reference.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account).containsExactly("2100", "1201");
    }

    @Test
    void aTransferThatPaysNoBillIsBookedToSuspense() {
        Movement transfer = transfer("BT1").bank().booked(-5_000).counterpartyName("Unknown Ltd").build();

        LedgerDTO.Entry entry = single(ledger(List.of(), List.of(transfer)).entries());

        assertThat(entry.status()).isEqualTo("TO_REVIEW");
        assertThat(entry.description()).isEqualTo("Transfer to Unknown Ltd");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account).containsExactly("1900", "1201");
    }

    @Test
    void aPaymentWithTheSingleUseCardOfABillSettlesTheBill() {
        Bill bill = bill(8, "BILL-2026-0002", 5_000, "20", "6220");
        bill.setPaymentMethod(Bill.PaymentMethod.CARD);
        bill.setPaymentInstrumentId("PI_BILL");
        Movement payment = transfer("C1").card("PI_BILL").booked(-6_000).counterpartyName("Office World").build();

        LedgerDTO.Entry entry = ledger(List.of(), List.of(bill), List.of(), List.of(payment)).entries().get(0);

        assertThat(entry.kind()).isEqualTo("CARD");
        assertThat(entry.status()).isEqualTo("MATCHED");
        assertThat(entry.description()).isEqualTo("Card payment · Office World · BILL-2026-0002");
        assertThat(entry.billId()).isEqualTo(8L);
        assertThat(entry.note()).isEqualTo("Matched to BILL-2026-0002 by its single-use card.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("2100", 6_000L, 0L), tuple("1201", 0L, 6_000L));
    }

    @Test
    void aClassifiedCardPaymentIsBookedToItsCategoryAndTheVatItIncludes() {
        Movement payment = transfer("C1").card("PI_CARD").booked(-1_100).counterpartyName("Le Bistrot").build();
        CardExpense expense = expense("C1", "6240", "10", true);

        LedgerDTO ledger = ledger(List.of(), List.of(), List.of(expense), List.of(payment));

        LedgerDTO.Entry entry = single(ledger.entries());
        assertThat(entry.kind()).isEqualTo("CARD");
        assertThat(entry.status()).isEqualTo("MATCHED");
        assertThat(entry.description()).isEqualTo("Card payment · Le Bistrot");
        assertThat(entry.note()).isEqualTo("Booked to 6240 Meals and entertainment, as classified on the card payment.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::label, LedgerDTO.Line::debit,
                LedgerDTO.Line::credit).containsExactly(
                tuple("6240", null, 1_000L, 0L),
                tuple("1400", "VAT 10%", 100L, 0L),
                tuple("1201", null, 0L, 1_100L));
        assertThat(ledger.summary().matchRate()).isEqualTo(100);
        assertThat(ledger.summary().balanced()).isTrue();
    }

    @Test
    void aCardPaymentWithoutItsReceiptSaysSo() {
        Movement payment = transfer("C1").card("PI_CARD").booked(-1_100).build();
        CardExpense expense = expense("C1", "6240", "10", false);

        LedgerDTO.Entry entry = single(ledger(List.of(), List.of(), List.of(expense), List.of(payment)).entries());

        assertThat(entry.status()).isEqualTo("MATCHED");
        assertThat(entry.note()).endsWith("as classified on the card payment. Receipt missing.");
    }

    @Test
    void aCardRefundReversesTheExpense() {
        Movement refund = transfer("C2").card("PI_CARD").booked(1_100).build();
        CardExpense expense = expense("C2", "6240", "10", false);

        LedgerDTO.Entry entry = single(ledger(List.of(), List.of(), List.of(expense), List.of(refund)).entries());

        assertThat(entry.description()).isEqualTo("Card refund");
        assertThat(entry.note()).doesNotContain("Receipt missing");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account, LedgerDTO.Line::debit, LedgerDTO.Line::credit)
                .containsExactly(tuple("1201", 1_100L, 0L), tuple("6240", 0L, 1_000L), tuple("1400", 0L, 100L));
    }

    @Test
    void anUnclassifiedCardPaymentIsBookedToSuspense() {
        Movement payment = transfer("C1").card("PI_CARD").booked(-500).counterpartyName("Cafe Central").build();

        LedgerDTO.Entry entry = single(ledger(List.of(), List.of(payment)).entries());

        assertThat(entry.status()).isEqualTo("TO_REVIEW");
        assertThat(entry.note()).isEqualTo("The card spend has no expense category yet: booked to Suspense.");
        assertThat(entry.lines()).extracting(LedgerDTO.Line::account).containsExactly("1900", "1201");
    }

    @Test
    void theChartHasTheExpenseCategories() {
        List<LedgerAccounts.Account> chart = ledger(List.of(), List.of()).accounts();

        assertThat(chart).extracting(LedgerAccounts.Account::code)
                .contains("1201", "1202", "2100", "6200", "6290")
                .isSorted();
    }
    @Test
    void namesAreReadable() {
        assertThat(LedgerRules.words("chargebackReversal")).isEqualTo("Chargeback reversal");
        assertThat(LedgerRules.words("DCCMarkup")).isEqualTo("DCC markup");
        assertThat(LedgerRules.words("VAT")).isEqualTo("VAT");
        assertThat(LedgerRules.words("AdyenFees")).isEqualTo("Adyen fees");
    }

    // ---------- Helpers ----------

    private static LedgerDTO ledger(List<Invoice> invoices, List<Movement> movements) {
        return ledger(invoices, List.of(), List.of(), movements);
    }

    private static LedgerDTO ledger(List<Invoice> invoices, List<Bill> bills, List<CardExpense> expenses,
                                    List<Movement> movements) {
        Map<String, LedgerRules.OwnAccount> accounts = new LinkedHashMap<>();
        accounts.put(MAIN, new LedgerRules.OwnAccount(MAIN, "Main Balance Account", false,
                LedgerAccounts.balanceAccount(0, "Main Balance Account")));
        accounts.put(BUSINESS, new LedgerRules.OwnAccount(BUSINESS, "Business Bank Account", true,
                LedgerAccounts.balanceAccount(1, "Business Bank Account")));
        return LedgerRules.build(new LedgerRules.Input(TODAY.minusDays(29), TODAY, "EUR", "VAT", invoices, bills,
                expenses, movements, accounts), true, List.of(), NOW);
    }

    private static <T> T single(List<T> values) {
        assertThat(values).hasSize(1);
        return values.get(0);
    }

    private static Invoice invoice(long id, String number, InvoiceLine... lines) {
        Customer customer = new Customer();
        customer.setId(1L);
        customer.setName("Jane Doe");
        customer.setCompany("Acme");
        customer.setEmail("jane@example.com");
        Invoice invoice = new Invoice();
        invoice.setId(id);
        invoice.setUserId("user000001");
        invoice.setNumber(number);
        invoice.setCustomer(customer);
        invoice.setStatus(Invoice.Status.SENT);
        invoice.setIssueDate(TODAY.minusDays(3));
        invoice.setDueDate(TODAY.plusDays(27));
        invoice.setCurrency("EUR");
        invoice.setSentAt(TODAY.minusDays(3).atStartOfDay(ZoneOffset.UTC).toInstant());
        List<InvoiceLine> list = new ArrayList<>(List.of(lines));
        invoice.replaceLines(list);
        long net = list.stream().mapToLong(InvoiceLine::getNetAmount).sum();
        long tax = list.stream().mapToLong(InvoiceLine::getTaxAmount).sum();
        invoice.setSubtotal(net);
        invoice.setTaxTotal(tax);
        invoice.setTotal(net + tax);
        return invoice;
    }

    private static InvoiceLine line(long quantity, long unitPrice, String vatRate) {
        BigDecimal rate = new BigDecimal(vatRate).setScale(2);
        InvoiceMath.Amounts amounts = InvoiceMath.line(quantity, unitPrice, rate);
        InvoiceLine line = new InvoiceLine();
        line.setSortOrder(0);
        line.setDescription("Item");
        line.setQuantity(quantity);
        line.setUnitPrice(unitPrice);
        line.setVatRate(rate);
        line.setNetAmount(amounts.net());
        line.setTaxAmount(amounts.tax());
        line.setGrossAmount(amounts.gross());
        return line;
    }

    private static Bill bill(long id, String number, long subtotal, String vatRate, String category) {
        Supplier supplier = new Supplier();
        supplier.setId(1L);
        supplier.setUserId("user000001");
        supplier.setName("BrightPixel Marketing");
        BigDecimal rate = new BigDecimal(vatRate).setScale(2);
        InvoiceMath.Amounts amounts = InvoiceMath.line(1, subtotal, rate);
        Bill bill = new Bill();
        bill.setId(id);
        bill.setUserId("user000001");
        bill.setNumber(number);
        bill.setSupplier(supplier);
        bill.setSupplierReference("F-1042");
        bill.setStatus(Bill.Status.TO_PAY);
        bill.setIssueDate(TODAY.minusDays(5));
        bill.setDueDate(TODAY.plusDays(25));
        bill.setCurrency("EUR");
        bill.setSubtotal(amounts.net());
        bill.setTaxTotal(amounts.tax());
        bill.setTotal(amounts.gross());
        bill.setVatRate(rate);
        bill.setCategory(category);
        return bill;
    }

    private static CardExpense expense(String transferId, String category, String vatRate, boolean receipt) {
        CardExpense expense = new CardExpense();
        expense.setId(1L);
        expense.setUserId("user000001");
        expense.setTransferId(transferId);
        expense.setCategory(category);
        expense.setVatRate(new BigDecimal(vatRate).setScale(2));
        if (receipt) {
            expense.setReceiptName("receipt.pdf");
        }
        return expense;
    }

    private static TransferBuilder transfer(String id) {
        return new TransferBuilder(id);
    }

    /** A booked movement of the main balance account, a platform payment unless told otherwise. */
    private static final class TransferBuilder {
        private final String id;
        private String balanceAccountId = MAIN;
        private String category = "platformPayment";
        private String type = "capture";
        private String platformPaymentType = "BalanceAccount";
        private String status = "booked";
        private Long amount;
        private long booked;
        private Instant at = NOW.minusSeconds(60);
        private String reference;
        private String description;
        private String psp;
        private String paymentReference;
        private String counterpartyBalanceAccountId;
        private String transferInstrumentId;
        private String counterpartyName;
        private String paymentInstrumentId;

        TransferBuilder(String id) {
            this.id = id;
        }

        TransferBuilder payment(long booked) {
            this.booked = booked;
            return this;
        }

        TransferBuilder booked(long booked) {
            this.booked = booked;
            return this;
        }

        TransferBuilder amount(long amount) {
            this.amount = amount;
            return this;
        }

        TransferBuilder status(String status) {
            this.status = status;
            return this;
        }

        TransferBuilder type(String type) {
            this.type = type;
            return this;
        }

        TransferBuilder paymentType(String platformPaymentType) {
            this.platformPaymentType = platformPaymentType;
            return this;
        }

        TransferBuilder psp(String psp) {
            this.psp = psp;
            return this;
        }

        TransferBuilder paymentReference(String paymentReference) {
            this.paymentReference = paymentReference;
            return this;
        }

        TransferBuilder reference(String reference) {
            this.reference = reference;
            return this;
        }

        TransferBuilder description(String description) {
            this.description = description;
            return this;
        }

        TransferBuilder account(String balanceAccountId) {
            this.balanceAccountId = balanceAccountId;
            return this;
        }

        TransferBuilder bank() {
            category = "bank";
            type = "bankTransfer";
            platformPaymentType = null;
            return this;
        }

        TransferBuilder internal(String counterpartyBalanceAccountId) {
            category = "internal";
            type = "internalTransfer";
            platformPaymentType = null;
            this.counterpartyBalanceAccountId = counterpartyBalanceAccountId;
            return this;
        }

        TransferBuilder card(String paymentInstrumentId) {
            category = "issuedCard";
            type = "payment";
            platformPaymentType = null;
            this.paymentInstrumentId = paymentInstrumentId;
            return this;
        }

        TransferBuilder transferInstrument(String transferInstrumentId) {
            this.transferInstrumentId = transferInstrumentId;
            return this;
        }

        TransferBuilder counterpartyName(String counterpartyName) {
            this.counterpartyName = counterpartyName;
            return this;
        }

        TransferBuilder at(Instant at) {
            this.at = at;
            return this;
        }

        Movement build() {
            return new Movement(id, balanceAccountId, category, type, platformPaymentType, status, "EUR",
                    amount != null ? amount : booked, booked, booked != 0 ? at : null, at, reference, description, null,
                    psp, paymentReference, null, counterpartyBalanceAccountId, transferInstrumentId, counterpartyName,
                    paymentInstrumentId, 1);
        }
    }
}
