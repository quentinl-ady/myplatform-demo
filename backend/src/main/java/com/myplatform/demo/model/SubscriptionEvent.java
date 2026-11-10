package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/** A step in the life of a subscription, shown as its timeline. */
@Entity
@Table(name = "subscription_event")
@Getter
@Setter
public class SubscriptionEvent {

    /**
     * Hibernate's schema update doesn't widen the check constraint it creates for an enum column, so the values of the
     * later features are listed already.
     */
    public enum Type {
        CREATED, UPDATED, CYCLE_BILLED, INVOICE_SENT, PAID, PAYMENT_METHOD_STORED, ACTIVATED, CHARGED, CHARGE_PENDING,
        CHARGE_REFUSED, CHARGE_FAILED, RESCUE_STOPPED, RESCUE_ENDED, PAST_DUE, REACTIVATED, CANCELLED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "subscription_id", nullable = false)
    private Subscription subscription;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Type type;

    @Column(nullable = false)
    private Instant occurredAt;

    @Column(length = 500)
    private String detail;

    /** The invoice the event is about, if any. */
    @Column(length = 20)
    private String invoiceNumber;

    /** The Adyen payment the event is about, if any: a webhook delivered twice doesn't log it twice. */
    private String pspReference;
}
