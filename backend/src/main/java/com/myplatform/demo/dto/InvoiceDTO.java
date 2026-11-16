package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * An invoice as the Invoices page shows it. Amounts are in minor units.
 *
 * @param status      DRAFT, SENT, OVERDUE (sent and past its due date), PAID or VOID
 * @param daysOverdue null unless the invoice is overdue
 * @param amountDue   what the customer still has to pay
 * @param paymentLink null until the invoice is sent
 * @param paymentMethod as Adyen reports it, e.g. "mc"
 * @param paymentMethodName readable, e.g. "Mastercard"
 * @param subscriptionId    the subscription whose billing cycle the invoice bills, null for a one-off invoice
 * @param subscriptionCycle the billing cycle, from 1
 * @param charge      the last charge to the payment method the subscription stored, null until there is one
 * @param editable    a draft that doesn't bill a subscription can be edited
 * @param sendable    a payment link can be created: the invoice is a draft, or its link expired, and no charge of it
 *                    is in progress
 * @param voidable    the invoice isn't paid or void yet, and doesn't bill a subscription
 * @param terminalId  the terminal the invoice was paid at, null when it was paid otherwise
 * @param terminalPayable the invoice can be paid at a terminal: it's sent, and no other payment of it is in progress
 * @param refundable  the payment can be refunded at a terminal: what it hasn't refunded yet
 * @param refundedAmount what the refunds Adyen confirmed gave back
 * @param refund      the last refund, null until there is one
 */
public record InvoiceDTO(Long id,
                         String number,
                         String status,
                         Long daysOverdue,
                         CustomerRef customer,
                         LocalDate issueDate,
                         LocalDate dueDate,
                         String currency,
                         long subtotal,
                         long taxTotal,
                         long total,
                         long amountDue,
                         List<Line> lines,
                         List<Vat> vat,
                         String notes,
                         PaymentLink paymentLink,
                         String pspReference,
                         String paymentMethod,
                         String paymentMethodName,
                         String storeReference,
                         Instant createdAt,
                         Instant sentAt,
                         Instant paidAt,
                         Instant voidedAt,
                         Long subscriptionId,
                         Integer subscriptionCycle,
                         Charge charge,
                         List<Event> events,
                         boolean editable,
                         boolean sendable,
                         boolean voidable,
                         String terminalId,
                         boolean terminalPayable,
                         boolean refundable,
                         long refundedAmount,
                         Refund refund) {

    public record CustomerRef(Long id, String displayName, String name, String company, String email,
                              String country, String vatNumber, String addressLine, String postalCode, String city) {
    }

    /** @param vatRate percent, e.g. 20.00 */
    public record Line(String description, long quantity, long unitPrice, BigDecimal vatRate,
                       long netAmount, long taxAmount, long grossAmount) {
    }

    /** The VAT of one rate. */
    public record Vat(BigDecimal rate, long base, long tax) {
    }

    /** @param status as Adyen last reported it: active, paymentPending, completed, paid or expired */
    public record PaymentLink(String id, String url, String status, Instant expiresAt, Instant checkedAt) {
    }

    /**
     * @param status   PENDING, REFUSED, RESCUING (refused, and Auto Rescue retries it) or AUTHORISED
     * @param attempts the charges Adyen answered
     */
    public record Charge(String status, String refusalReason, int attempts, Instant chargedAt) {
    }

    public record Event(String type, Instant occurredAt, String detail, String pspReference) {
    }

    /**
     * @param status      REQUESTED (Adyen hasn't confirmed it yet), REFUNDED or FAILED
     * @param terminalId  the terminal it was requested at, null when it was made otherwise
     */
    public record Refund(String status, Instant requestedAt, Instant refundedAt, String failureReason, String terminalId,
                         String pspReference) {
    }
}
