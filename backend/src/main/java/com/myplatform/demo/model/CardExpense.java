package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * How a card payment of the user is booked: its expense category, its VAT rate and a note, with the receipt that
 * proves it. Linked to the transfer of the payment at Adyen; the payment's details are those it had when it was
 * classified. Amounts are in minor units.
 */
@Entity
@Table(name = "card_expense")
@Getter
@Setter
public class CardExpense {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String userId;

    /** The transfer of the card payment at Adyen. */
    @Column(nullable = false, length = 64)
    private String transferId;

    private String paymentInstrumentId;

    @Column(length = 100)
    private String merchantName;

    /** The merchant category code, e.g. 5812 for a restaurant. */
    @Column(length = 4)
    private String mcc;

    /** outgoing for a payment, incoming for a refund. */
    @Column(length = 10)
    private String direction;

    /** Unsigned, as Adyen reports it. */
    private Long amount;

    @Column(length = 3)
    private String currency;

    /** When the payment was made. */
    private Instant occurredAt;

    /** The expense account it's booked to, e.g. 6230. */
    @Column(nullable = false, length = 10)
    private String category;

    /** Percent, up to 2 decimals: 20.00, 5.50. */
    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal vatRate;

    @Column(length = 500)
    private String note;

    /** The receipt's file; its content is a {@link CardExpenseReceipt}, only loaded to download it. */
    @Column(length = 120)
    private String receiptName;

    @Column(length = 40)
    private String receiptType;

    private Integer receiptSize;

    private Instant receiptUploadedAt;

    private Instant createdAt;

    private Instant updatedAt;

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
