package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.myplatform.demo.model.Invoice;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Objects;

/** The seller's incoming settlement leg, not commission, fees or refunds. */
public final class InvoiceFunds {

    private InvoiceFunds() {
    }

    public record Settlement(String transferId, Instant valueDate, long amount, int sequenceNumber) {
    }

    public static Settlement settlement(JsonNode data, String pspReference, String balanceAccountId, String currency) {
        AdyenTransfers.Movement movement = AdyenTransfers.movement(data);
        if (movement == null || pspReference == null || balanceAccountId == null
                || !"platformPayment".equals(movement.category())
                || !pspReference.equals(movement.pspPaymentReference())
                || !balanceAccountId.equals(movement.balanceAccountId())
                || !Objects.equals(currency, movement.currency()) || movement.amount() <= 0
                || !"incoming".equals(data.path("direction").asText())
                || (movement.type() != null && !"capture".equalsIgnoreCase(movement.type()))
                || (movement.platformPaymentType() != null
                && !"BalanceAccount".equalsIgnoreCase(movement.platformPaymentType()))
                || (movement.type() == null && movement.platformPaymentType() == null)) {
            return null;
        }
        Instant valueDate = null;
        for (JsonNode event : data.path("events")) {
            String status = event.path("status").asText();
            if (!"captured".equals(status) && !"booked".equals(status) && !"credited".equals(status)) {
                continue;
            }
            Instant at = instant(event.path("valueDate").asText(null));
            if (at != null && (valueDate == null || at.isAfter(valueDate))) {
                valueDate = at;
            }
        }
        return valueDate == null ? null
                : new Settlement(movement.id(), valueDate, movement.amount(), movement.sequenceNumber());
    }

    public static boolean apply(Invoice invoice, Settlement settlement) {
        if (settlement == null || (invoice.getFundsSequenceNumber() != null
                && Objects.equals(invoice.getFundsTransferId(), settlement.transferId())
                && invoice.getFundsSequenceNumber() > settlement.sequenceNumber())) {
            return false;
        }
        if (invoice.getFundsValueDate() != null && invoice.getFundsValueDate().isAfter(settlement.valueDate())
                && (!Objects.equals(invoice.getFundsTransferId(), settlement.transferId())
                || Objects.equals(invoice.getFundsSequenceNumber(), settlement.sequenceNumber()))) {
            return false;
        }
        boolean changed = !Objects.equals(invoice.getFundsValueDate(), settlement.valueDate())
                || !Objects.equals(invoice.getFundsAmount(), settlement.amount())
                || !Objects.equals(invoice.getFundsTransferId(), settlement.transferId())
                || !Objects.equals(invoice.getFundsSequenceNumber(), settlement.sequenceNumber());
        invoice.setFundsValueDate(settlement.valueDate());
        invoice.setFundsAmount(settlement.amount());
        invoice.setFundsTransferId(settlement.transferId());
        invoice.setFundsSequenceNumber(settlement.sequenceNumber());
        return changed;
    }

    private static Instant instant(String value) {
        if (value == null) return null;
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException e) {
            try {
                return LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant();
            } catch (DateTimeParseException ignored) {
                return null;
            }
        }
    }
}
