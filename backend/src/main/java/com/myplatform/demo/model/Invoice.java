package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** A customer invoice, paid through an Adyen payment link. Amounts are in minor units. */
@Entity
@Table(name = "invoice")
@Getter
@Setter
public class Invoice {

    /** Overdue isn't stored: it's a sent invoice past its due date. */
    public enum Status { DRAFT, SENT, PAID, VOID }

    /**
     * The last charge of a subscription invoice to the stored payment method. RESCUING: refused, and Adyen Auto Rescue
     * retries it. Hibernate's schema update doesn't widen the check constraint it creates for an enum column, so all
     * the values are listed already.
     */
    public enum ChargeStatus { PENDING, REFUSED, RESCUING, AUTHORISED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String userId;

    /** INV-2026-0001: numbered per user and per year of issue. */
    @Column(name = "invoice_number", nullable = false, length = 20)
    private String number;

    @Column(nullable = false)
    private Integer sequenceYear;

    @Column(nullable = false)
    private Integer sequenceNumber;

    @ManyToOne(optional = false)
    @JoinColumn(name = "customer_id", nullable = false)
    private Customer customer;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status;

    @Column(nullable = false)
    private LocalDate issueDate;

    @Column(nullable = false)
    private LocalDate dueDate;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(nullable = false)
    private Long subtotal;

    @Column(nullable = false)
    private Long taxTotal;

    @Column(nullable = false)
    private Long total;

    @Column(length = 1000)
    private String notes;

    private String paymentLinkId;

    @Column(length = 500)
    private String paymentLinkUrl;

    private Instant paymentLinkExpiresAt;

    /** As Adyen last reported it: active, paymentPending, completed, paid or expired. */
    @Column(length = 20)
    private String paymentLinkStatus;

    private Instant paymentLinkCheckedAt;

    /** The store that processes the payment of an embedded payments user. */
    private String storeReference;

    private String pspReference;

    private String paymentMethod;

    private Instant createdAt;

    private Instant updatedAt;

    private Instant sentAt;

    private Instant paidAt;

    private Instant voidedAt;

    /** Set on the invoices created by the demo data, so loading it again doesn't duplicate them. */
    @Column(length = 40)
    private String demoKey;

    // The columns below were added to an existing table, so they must accept null.

    /** The subscription whose billing cycle the invoice bills, null for a one-off invoice. */
    private Long subscriptionId;

    /** The billing cycle of the subscription, from 1. */
    private Integer subscriptionCycle;

    /**
     * The merchantOrderReference of the charges of the invoice. Unique across the merchant account, which other
     * environments share, so the webhooks of Auto Rescue retries find the invoice.
     */
    @Column(length = 40)
    private String chargeReference;

    /** Null until the invoice is charged to a stored payment method. */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private ChargeStatus chargeStatus;

    /** The payment of the last charge. An Auto Rescue retry that succeeds is another payment, with its own reference. */
    private String chargePspReference;

    @Column(length = 200)
    private String chargeRefusalReason;

    /** The charges Adyen answered: each new one has its own idempotency key. */
    private Integer chargeAttempts;

    private Instant chargedAt;

    /** Auto Rescue's reference of the refused charge it retries: stopping the rescue needs it. */
    private String rescueReference;

    // Two eager lists can't be fetched in one join: each one is loaded with its own query.
    @OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Fetch(FetchMode.SUBSELECT)
    @OrderBy("sortOrder ASC")
    @Setter(AccessLevel.NONE)
    private List<InvoiceLine> lines = new ArrayList<>();

    @OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Fetch(FetchMode.SUBSELECT)
    @OrderBy("occurredAt ASC, id ASC")
    @Setter(AccessLevel.NONE)
    private List<InvoiceEvent> events = new ArrayList<>();

    public void replaceLines(List<InvoiceLine> newLines) {
        lines.clear();
        for (InvoiceLine line : newLines) {
            line.setInvoice(this);
            lines.add(line);
        }
    }

    public InvoiceEvent addEvent(InvoiceEvent.Type type, Instant occurredAt, String detail, String pspReference) {
        InvoiceEvent event = new InvoiceEvent();
        event.setInvoice(this);
        event.setType(type);
        event.setOccurredAt(occurredAt);
        event.setDetail(detail);
        event.setPspReference(pspReference);
        events.add(event);
        return event;
    }

    @PrePersist
    public void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    public void preUpdate() {
        updatedAt = Instant.now();
    }
}
