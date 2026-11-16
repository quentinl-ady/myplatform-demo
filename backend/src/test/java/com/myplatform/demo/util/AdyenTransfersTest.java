package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.util.AdyenTransfers.Movement;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AdyenTransfersTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void aTransferBooksWhatItsAccountingEventsMoveToTheBalance() throws Exception {
        Movement movement = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "T1", "balanceAccount": {"id": "BA1"}, "category": "platformPayment", "type": "capture",
                 "direction": "incoming", "status": "booked", "amount": {"currency": "EUR", "value": 1000},
                 "createdAt": "2026-11-01T10:00:00+01:00", "sequenceNumber": 2,
                 "categoryData": {"type": "platformPayment", "platformPaymentType": "BalanceAccount",
                                  "pspPaymentReference": "PSP1", "paymentMerchantReference": "INV-2026-0001"},
                 "events": [
                   {"type": "accounting", "status": "received", "bookingDate": "2026-11-01T10:00:00+01:00",
                    "mutations": [{"currency": "EUR", "received": 1000}]},
                   {"type": "accounting", "status": "booked", "bookingDate": "2026-11-02T08:00:00+01:00",
                    "mutations": [{"currency": "EUR", "received": -1000, "balance": 1000}]}
                 ]}
                """));

        assertThat(movement.amount()).isEqualTo(1000);
        assertThat(movement.booked()).isEqualTo(1000);
        assertThat(movement.bookedAt()).isEqualTo(Instant.parse("2026-11-02T07:00:00Z"));
        assertThat(movement.createdAt()).isEqualTo(Instant.parse("2026-11-01T09:00:00Z"));
        assertThat(movement.platformPaymentType()).isEqualTo("BalanceAccount");
        assertThat(movement.pspPaymentReference()).isEqualTo("PSP1");
        assertThat(movement.paymentMerchantReference()).isEqualTo("INV-2026-0001");
        assertThat(movement.sequenceNumber()).isEqualTo(2);
    }

    @Test
    void anAuthorisedCardPaymentOnlyReservesFunds() throws Exception {
        Movement movement = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "C1", "balanceAccount": {"id": "BA1"}, "category": "issuedCard", "type": "payment",
                 "direction": "outgoing", "status": "authorised", "amount": {"currency": "EUR", "value": 500},
                 "counterparty": {"merchant": {"nameLocation": {"name": "Cafe Central"}}},
                 "paymentInstrument": {"id": "PI1", "description": "Virtual card"},
                 "events": [{"type": "accounting", "status": "authorised",
                             "mutations": [{"currency": "EUR", "reserved": -500}]}]}
                """));

        assertThat(movement.isBooked()).isFalse();
        assertThat(movement.bookedAt()).isNull();
        assertThat(movement.amount()).isEqualTo(-500);
        assertThat(movement.counterpartyName()).isEqualTo("Cafe Central");
        assertThat(movement.paymentInstrumentId()).isEqualTo("PI1");
    }

    @Test
    void aReturnedBankTransferBooksNothing() throws Exception {
        Movement movement = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "B1", "balanceAccount": {"id": "BA1"}, "category": "bank", "direction": "outgoing",
                 "status": "returned", "amount": {"currency": "EUR", "value": 700},
                 "counterparty": {"bankAccount": {"accountHolder": {"fullName": "Supplier Ltd"}}},
                 "events": [
                   {"type": "accounting", "status": "booked", "bookingDate": "2026-11-01T10:00:00Z",
                    "mutations": [{"currency": "EUR", "balance": -700}]},
                   {"type": "accounting", "status": "returned", "bookingDate": "2026-11-03T10:00:00Z",
                    "mutations": [{"currency": "EUR", "balance": 700}]}
                 ]}
                """));

        assertThat(movement.booked()).isZero();
        assertThat(movement.counterpartyName()).isEqualTo("Supplier Ltd");
    }

    @Test
    void withoutEventsTheStatusTellsWhetherTheTransferIsBooked() throws Exception {
        Movement movement = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "P1", "balanceAccount": {"id": "BA1"}, "category": "bank", "direction": "outgoing",
                 "status": "booked", "amount": {"currency": "EUR", "value": 300},
                 "createdAt": "2026-11-01T10:00:00Z", "counterparty": {"transferInstrumentId": "SE1"}}
                """));

        assertThat(movement.booked()).isEqualTo(-300);
        assertThat(movement.bookedAt()).isEqualTo(Instant.parse("2026-11-01T10:00:00Z"));
        assertThat(movement.counterpartyTransferInstrumentId()).isEqualTo("SE1");
    }

    @Test
    void aPageLinksToTheNextOne() throws Exception {
        AdyenTransfers.Page page = AdyenTransfers.page(MAPPER.readTree("""
                {"data": [{"id": "T1", "balanceAccount": {"id": "BA1"}}, {"id": "T2"}],
                 "_links": {"next": {"href": "https://balanceplatform-api-test.adyen.com/btl/v4/transfers?cursor=abc"}}}
                """));

        assertThat(page.movements()).extracting(Movement::id).containsExactly("T1");
        assertThat(page.next()).isEqualTo("https://balanceplatform-api-test.adyen.com/btl/v4/transfers?cursor=abc");
    }

    @Test
    void theLatestVersionOfATransferIsKept() throws Exception {
        Movement first = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "T1", "balanceAccount": {"id": "BA1"}, "status": "received", "sequenceNumber": 1}
                """));
        Movement second = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "T1", "balanceAccount": {"id": "BA1"}, "status": "booked", "sequenceNumber": 2}
                """));
        Movement otherAccount = AdyenTransfers.movement(MAPPER.readTree("""
                {"id": "T1", "balanceAccount": {"id": "BA2"}, "status": "booked", "sequenceNumber": 1}
                """));

        List<Movement> latest = AdyenTransfers.latest(List.of(second, first, otherAccount));

        assertThat(latest).extracting(Movement::balanceAccountId, Movement::status)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("BA1", "booked"),
                        org.assertj.core.groups.Tuple.tuple("BA2", "booked"));
    }
}
