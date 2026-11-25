package com.myplatform.demo.util;

import com.myplatform.demo.model.Invoice;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class InvoiceOnlineRefundTest {
    private static final Instant NOW = Instant.parse("2026-11-16T10:00:00Z");

    private Invoice invoice() {
        Invoice invoice = new Invoice();
        invoice.setStatus(Invoice.Status.PAID);
        invoice.setPspReference("PSP1");
        invoice.setCurrency("EUR");
        invoice.setTotal(12000L);
        return invoice;
    }

    @Test
    void requestsOnlyTheRemainderClearsTerminalFailureAndWaitsForConfirmation() {
        Invoice invoice = invoice();
        invoice.setRefundedAmount(2000L);
        invoice.setRefundStatus(Invoice.RefundStatus.FAILED);
        invoice.setRefundTerminalId("TERMINAL1");
        invoice.setRefundFailureReason("Declined");
        assertThat(InvoiceTerminalRules.notRefundable(invoice)).isNull();
        assertThat(InvoiceTerminalRules.refundableAmount(invoice)).isEqualTo(10000);
        InvoiceTerminalRules.requestOnlineRefund(invoice, "REF1", NOW);
        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REQUESTED);
        assertThat(invoice.getRefundTerminalId()).isNull();
        assertThat(invoice.getRefundFailureReason()).isNull();
        assertThat(invoice.getRefundRequestedAt()).isEqualTo(NOW);
        assertThat(invoice.getRefundPspReference()).isEqualTo("REF1");
        assertThat(invoice.getRefundedAmount()).isEqualTo(2000);
        assertThat(InvoiceTerminalRules.notRefundable(invoice)).contains("already in progress");
        var notification = new InvoiceTerminalRules.RefundNotification("REFUND", true, "REF1", "PSP1",
                10000L, null, null, NOW.plusSeconds(30));
        assertThat(InvoiceTerminalRules.applyRefundNotification(invoice, notification)).isTrue();
        assertThat(InvoiceTerminalRules.applyRefundNotification(invoice, notification)).isFalse();
        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.REFUNDED);
        assertThat(invoice.getRefundedAmount()).isEqualTo(12000);
        assertThat(invoice.getEvents().get(0).getDetail()).isEqualTo("Refunded 100.00 EUR online to the customer.");
        assertThat(InvoiceTerminalRules.notRefundable(invoice)).isEqualTo("This invoice is already refunded.");
    }

    @Test
    void onlineRefundRefusalAllowsRetryAndKeepsItsOnlineChannel() {
        Invoice invoice = invoice();
        InvoiceTerminalRules.requestOnlineRefund(invoice, "REF1", NOW);
        var notification = new InvoiceTerminalRules.RefundNotification("REFUND", false, "REF1", "PSP1",
                12000L, "Not captured", null, NOW.plusSeconds(30));
        assertThat(InvoiceTerminalRules.applyRefundNotification(invoice, notification)).isTrue();
        assertThat(invoice.getRefundStatus()).isEqualTo(Invoice.RefundStatus.FAILED);
        assertThat(invoice.getRefundFailureReason()).isEqualTo("Not captured");
        assertThat(invoice.getRefundTerminalId()).isNull();
        assertThat(InvoiceTerminalRules.notRefundable(invoice)).isNull();
    }
}
