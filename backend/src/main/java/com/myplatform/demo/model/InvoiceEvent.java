package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/** A step in the life of an invoice, shown as its timeline. */
@Entity
@Table(name = "invoice_event")
@Getter
@Setter
public class InvoiceEvent {

    /**
     * Hibernate's schema update doesn't widen the check constraint it creates for an enum column, so the
     * values of the later features are listed already.
     */
    public enum Type {
        CREATED, UPDATED, SENT, LINK_RENEWED, LINK_EXPIRED, PAYMENT_PENDING, PAYMENT_REFUSED, PAID, VOIDED,
        CHARGE_SUBMITTED, REFUNDED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "invoice_id", nullable = false)
    private Invoice invoice;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Type type;

    @Column(nullable = false)
    private Instant occurredAt;

    @Column(length = 500)
    private String detail;

    private String pspReference;
}
