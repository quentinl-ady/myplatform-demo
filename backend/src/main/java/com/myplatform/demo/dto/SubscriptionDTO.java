package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * A subscription as the Subscriptions page shows it. Amounts are in minor units.
 *
 * @param status             AWAITING_PAYMENT_METHOD, ACTIVE, PAST_DUE or CANCELLED
 * @param frequency          MONTHLY or YEARLY
 * @param price              per billing cycle, excluding VAT
 * @param total              per billing cycle, including VAT
 * @param nextBillingDate    the first day of the next cycle to bill
 * @param paymentMethod      the payment method the cycles are charged to, null until the first invoice stored one
 * @param invoices           the latest cycle first
 * @param runCycleBlocked    why the next cycle can't be billed now, null when it can
 * @param retryInvoiceNumber the invoice whose refused charge running the cycle charges again, instead of billing a
 *                           new cycle; null otherwise
 * @param cardOutcomes       the payment method is a card, so TEST refusals can be simulated
 * @param warning            what went wrong while creating the subscription, e.g. its first payment link; null
 *                           otherwise
 */
public record SubscriptionDTO(Long id,
                              String status,
                              CustomerRef customer,
                              String plan,
                              String frequency,
                              long price,
                              BigDecimal vatRate,
                              long total,
                              String currency,
                              LocalDate startDate,
                              LocalDate nextBillingDate,
                              int cyclesBilled,
                              PaymentMethod paymentMethod,
                              boolean autoRescue,
                              Integer rescueDays,
                              Instant createdAt,
                              Instant activatedAt,
                              Instant pastDueSince,
                              Instant cancelledAt,
                              List<InvoiceRef> invoices,
                              List<Event> events,
                              String runCycleBlocked,
                              String retryInvoiceNumber,
                              boolean rescueStoppable,
                              boolean cancellable,
                              boolean cardOutcomes,
                              String warning) {

    public record CustomerRef(Long id, String displayName, String email) {
    }

    /**
     * @param variant    as Adyen names it, e.g. mc or sepadirectdebit
     * @param label      e.g. "Mastercard •••• 1111"
     * @param lastDigits of the card or of the IBAN
     * @param expiry     MM/YYYY, for a card
     */
    public record PaymentMethod(String variant, String name, String label, String lastDigits, String expiry,
                                String holder, Instant storedAt, boolean card) {
    }

    /**
     * @param status         DRAFT, SENT, OVERDUE, PAID or VOID
     * @param chargeStatus   PENDING, REFUSED, RESCUING or AUTHORISED; null until the invoice is charged
     * @param paymentLinkUrl the link the customer can still pay with, null otherwise
     * @param sendable       a payment link can be sent for the invoice
     */
    public record InvoiceRef(Long id, String number, int cycle, LocalDate periodStart, LocalDate periodEnd,
                             String status, long total, LocalDate dueDate, String chargeStatus,
                             String chargeRefusalReason, Instant paidAt, String paymentLinkUrl, boolean sendable) {
    }

    public record Event(String type, Instant occurredAt, String detail, String invoiceNumber) {
    }
}
