package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.util.AdyenTransfers.Movement;
import com.myplatform.demo.util.SweepBreakdown.Transaction;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SweepBreakdownTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void readsTheTransactionsOfAPage() throws Exception {
        SweepBreakdown.Page page = SweepBreakdown.page(MAPPER.readTree("""
                {"data": [
                  {"id": "TX1", "status": "booked", "amount": {"currency": "EUR", "value": -5724},
                   "transfer": {"id": "SW2", "reference": "balance-sweep-SWPE1"},
                   "creationDate": "2026-11-16T10:02:00+01:00", "bookingDate": "2026-11-16T10:02:01+01:00",
                   "valueDate": "2026-11-16T10:02:01+01:00", "description": "Sweep"},
                  {"status": "booked", "amount": {"currency": "EUR", "value": 1}}
                ],
                 "_links": {"next": {"href": "https://example.test/transactions?cursor=abc"}}}
                """));

        assertThat(page.transactions()).hasSize(1);
        Transaction transaction = page.transactions().get(0);
        assertThat(transaction.transferId()).isEqualTo("SW2");
        assertThat(transaction.amount()).isEqualTo(-5724);
        assertThat(transaction.bookedAt()).isEqualTo(Instant.parse("2026-11-16T09:02:01Z"));
        assertThat(transaction.isSweepOut()).isTrue();
        assertThat(page.next()).isEqualTo("https://example.test/transactions?cursor=abc");
    }

    @Test
    void aSweepIncludesWhatBecameAvailableSinceTheSweepBefore() {
        List<Transaction> transactions = List.of(
                booked("OLD", "P0", null, 300, "09:55"),
                sweep("TX-SW1", "SW1", "SWPE0", -300, "10:00"),
                booked("PAY1", "P1", null, 1000, "10:00:30"),
                booked("FEE1", "F1", null, -12, "10:01"),
                booked("PAY2", "P2", null, 500, "10:01:30"),
                sweep("TX-SW2", "SW2", "SWPE1", -1488, "10:02"),
                booked("LATER", "P3", null, 700, "10:03"));

        SweepBreakdown.Result result = SweepBreakdown.breakdown("SW2", "balance-sweep-SWPE1", 1488, transactions);

        assertThat(result.sweep().id()).isEqualTo("TX-SW2");
        assertThat(result.previousSweep().id()).isEqualTo("TX-SW1");
        assertThat(result.included()).extracting(Transaction::id).containsExactly("PAY1", "FEE1", "PAY2");
        assertThat(result.includedTotal()).isEqualTo(1488);
    }

    @Test
    void aPaymentIsOnlySweptOnceItsFundsAreAvailable() {
        List<Transaction> transactions = List.of(
                sweep("TX-SW1", "SW1", "SWPE0", -100, "10:00"),
                booked("SETTLED", "P1", null, 400, "10:01"),
                booked("PENDING", "P2", "2026-11-17T10:00:00Z", 900, "10:01"),
                pending("RECEIVED", "P3", 250, "10:01"),
                sweep("TX-SW2", "SW2", "SWPE1", -400, "10:02"));

        SweepBreakdown.Result result = SweepBreakdown.breakdown("SW2", "balance-sweep-SWPE1", 400, transactions);

        assertThat(result.included()).extracting(Transaction::id).containsExactly("SETTLED");
    }

    @Test
    void aPaymentBookedBeforeASweepButAvailableAfterItGoesToTheNextOne() {
        List<Transaction> transactions = List.of(
                booked("PAY", "P1", "2026-11-16T10:01:00Z", 400, "09:59"),
                sweep("TX-SW1", "SW1", "SWPE0", -100, "10:00"),
                sweep("TX-SW2", "SW2", "SWPE1", -400, "10:02"));

        SweepBreakdown.Result first = SweepBreakdown.breakdown("SW1", "balance-sweep-SWPE0", 100, transactions);
        SweepBreakdown.Result second = SweepBreakdown.breakdown("SW2", "balance-sweep-SWPE1", 400, transactions);

        assertThat(first.included()).isEmpty();
        assertThat(second.included()).extracting(Transaction::id).containsExactly("PAY");
    }

    @Test
    void withoutASweepBeforeEveryEarlierMovementIsIncluded() {
        List<Transaction> transactions = List.of(
                booked("PAY1", "P1", null, 1000, "09:00"),
                booked("PAY2", "P2", null, 200, "09:30"),
                sweep("TX-SW1", "SW1", "SWPE0", -1500, "10:00"));

        SweepBreakdown.Result result = SweepBreakdown.breakdown("SW1", "balance-sweep-SWPE0", 1500, transactions);

        assertThat(result.previousSweep()).isNull();
        assertThat(result.included()).extracting(Transaction::id).containsExactly("PAY1", "PAY2");
        assertThat(1500 - result.includedTotal()).isEqualTo(300);
    }

    @Test
    void theSweepIsFoundByItsReferenceWhenItsTransactionNamesAnotherTransfer() {
        List<Transaction> transactions = List.of(
                booked("PAY1", "P1", null, 1000, "10:01"),
                sweep("TX-SW1", "OTHER-ID", "SWPE0", -1000, "10:02"));

        SweepBreakdown.Result result = SweepBreakdown.breakdown("SW1", "balance-sweep-SWPE0", 1000, transactions);

        assertThat(result.sweep().id()).isEqualTo("TX-SW1");
        assertThat(result.included()).extracting(Transaction::id).containsExactly("PAY1");
    }

    @Test
    void aSweepNotBookedYetHasNoBreakdown() {
        List<Transaction> transactions = List.of(booked("PAY1", "P1", null, 1000, "10:01"));

        assertThat(SweepBreakdown.breakdown("SW1", "balance-sweep-SWPE0", 1000, transactions)).isNull();
    }

    @Test
    void describesPaymentsFeesRefundsAndChargebacks() {
        Transaction credit = booked("TX", "T1", null, 1000, "10:00");
        Transaction debit = booked("TX", "T1", null, -50, "10:00");

        assertThat(SweepBreakdown.describe(credit, movement("platformPayment", "capture", "BalanceAccount")))
                .isEqualTo(new SweepBreakdown.Description("PAYMENT", "Payment", "INV-1", "PSP1"));
        assertThat(SweepBreakdown.describe(debit, movement("platformPayment", "capture", "SchemeFee")))
                .isEqualTo(new SweepBreakdown.Description("FEE", "Scheme fee", "INV-1", "PSP1"));
        assertThat(SweepBreakdown.describe(debit, movement("platformPayment", "capture", "AdyenCommission")).label())
                .isEqualTo("Processing commission");
        assertThat(SweepBreakdown.describe(debit, movement("platformPayment", "refund", "BalanceAccount")))
                .isEqualTo(new SweepBreakdown.Description("REFUND", "Refund", "INV-1", "PSP1"));
        assertThat(SweepBreakdown.describe(debit, movement("platformPayment", "chargeback", "BalanceAccount")).kind())
                .isEqualTo("CHARGEBACK");
        assertThat(SweepBreakdown.describe(debit, movement("internal", "internalTransfer", null)).label())
                .isEqualTo("Transfer to another account");
        assertThat(SweepBreakdown.describe(debit, null))
                .isEqualTo(new SweepBreakdown.Description("OTHER", "Movement", "ref-T1", null));
    }

    private static Transaction booked(String id, String transferId, String valueAt, long amount, String time) {
        Instant bookedAt = at(time);
        return new Transaction(id, transferId, "ref-" + transferId, "booked", amount, "EUR", bookedAt, bookedAt,
                valueAt == null ? bookedAt : Instant.parse(valueAt), null);
    }

    private static Transaction pending(String id, String transferId, long amount, String time) {
        Instant createdAt = at(time);
        return new Transaction(id, transferId, "ref-" + transferId, "pending", amount, "EUR", createdAt, null, null,
                null);
    }

    private static Transaction sweep(String id, String transferId, String execution, long amount, String time) {
        Instant bookedAt = at(time);
        return new Transaction(id, transferId, SweepBreakdown.SWEEP_REFERENCE_PREFIX + execution, "booked", amount,
                "EUR", bookedAt, bookedAt, bookedAt, null);
    }

    private static Instant at(String time) {
        return Instant.parse("2026-11-16T" + (time.length() == 5 ? time + ":00" : time) + "Z");
    }

    private static Movement movement(String category, String type, String platformPaymentType) {
        return new Movement("T1", "BA1", category, type, platformPaymentType, "booked", "EUR", 0, 0, null, null,
                "ref-T1", null, null, "PSP1", "INV-1", null, null, null, null, null, 0);
    }
}
