package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.myplatform.demo.model.Invoice;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class InvoiceFundsTest {
    private final ObjectMapper mapper = new ObjectMapper();

    private ObjectNode transfer() throws Exception {
        return (ObjectNode) mapper.readTree("""
                {
                  "id": "TR1", "sequenceNumber": 3,
                  "category": "platformPayment", "type": "capture", "direction": "incoming",
                  "status": "captured", "balanceAccount": {"id": "BA1"},
                  "amount": {"value": 10800, "currency": "EUR"},
                  "categoryData": {"pspPaymentReference": "PSP1", "platformPaymentType": "BalanceAccount"},
                  "events": [
                    {"status": "received"},
                    {"status": "authorised"},
                    {"status": "captured", "bookingDate": "2026-11-25T10:00:00Z",
                     "valueDate": "2026-11-27T00:00:00+01:00"}
                  ]
                }
                """);
    }

    @Test
    void readsCapturedValueDateRatherThanBookingDate() throws Exception {
        var result = InvoiceFunds.settlement(transfer(), "PSP1", "BA1", "EUR");
        assertThat(result).isEqualTo(new InvoiceFunds.Settlement("TR1",
                Instant.parse("2026-11-26T23:00:00Z"), 10800, 3));
    }

    @Test
    void acceptsEitherCaptureOrBalanceAccountClassificationButNotNeither() throws Exception {
        var data = transfer();
        data.remove("type");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNotNull();
        data = transfer();
        ((ObjectNode) data.path("categoryData")).remove("platformPaymentType");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNotNull();
        data.remove("type");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
    }

    @Test
    void ignoresOtherAccountsPaymentsCurrenciesAndOutgoingOrCommissionLegs() throws Exception {
        assertThat(InvoiceFunds.settlement(transfer(), "PSP1", "OTHER", "EUR")).isNull();
        assertThat(InvoiceFunds.settlement(transfer(), "OTHER", "BA1", "EUR")).isNull();
        assertThat(InvoiceFunds.settlement(transfer(), "PSP1", "BA1", "USD")).isNull();
        var data = transfer();
        data.put("direction", "outgoing");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
        data = transfer();
        ((ObjectNode) data.path("categoryData")).put("platformPaymentType", "Commission");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
        data = transfer();
        data.put("type", "refund");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
    }

    @Test
    void waitsForCapturedEventWithValidValueDate() throws Exception {
        var data = transfer();
        ((ObjectNode) data.path("events").get(2)).remove("valueDate");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
        ((ObjectNode) data.path("events").get(0)).put("valueDate", "2026-11-25");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
        ((ObjectNode) data.path("events").get(2)).put("valueDate", "not-a-date");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR")).isNull();
        ((ObjectNode) data.path("events").get(2)).put("valueDate", "2026-11-27");
        assertThat(InvoiceFunds.settlement(data, "PSP1", "BA1", "EUR").valueDate())
                .isEqualTo(Instant.parse("2026-11-27T00:00:00Z"));
    }

    @Test
    void duplicatesIncompleteAndOlderUpdatesDoNotUndoTheLatestSettlement() throws Exception {
        var invoice = new Invoice();
        var settlement = InvoiceFunds.settlement(transfer(), "PSP1", "BA1", "EUR");
        assertThat(InvoiceFunds.apply(invoice, settlement)).isTrue();
        assertThat(InvoiceFunds.apply(invoice, settlement)).isFalse();
        assertThat(InvoiceFunds.apply(invoice, null)).isFalse();
        assertThat(InvoiceFunds.apply(invoice, new InvoiceFunds.Settlement("TR1",
                Instant.parse("2026-11-25T00:00:00Z"), 10000, 2))).isFalse();
        assertThat(InvoiceFunds.apply(invoice, new InvoiceFunds.Settlement("TR1",
                Instant.parse("2026-11-25T00:00:00Z"), 10000, 3))).isFalse();
        assertThat(invoice.getFundsAmount()).isEqualTo(10800);
        assertThat(InvoiceFunds.apply(invoice, new InvoiceFunds.Settlement("TR1",
                Instant.parse("2026-11-28T00:00:00Z"), 10800, 4))).isTrue();
    }
}
