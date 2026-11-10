package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/** A step in the life of a bill, shown as its timeline. */
@Entity
@Table(name = "bill_event")
@Getter
@Setter
public class BillEvent {

    /**
     * Hibernate's schema update doesn't widen the check constraint it creates for an enum column, so the values of the
     * later features are listed already.
     */
    public enum Type {
        CREATED, UPDATED, PAYEE_CHECKED, TRANSFER_CREATED, TRANSFER_APPROVED, TRANSFER_FAILED, CARD_ISSUED,
        CARD_CHARGED, CARD_REFUSED, CARD_CLOSED, PAID
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "bill_id", nullable = false)
    private Bill bill;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Type type;

    @Column(nullable = false)
    private Instant occurredAt;

    @Column(length = 500)
    private String detail;

    private String transferId;
}
