package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/** Capture or cancellation of a CheckoutPayment. */
@Entity
@Table(name = "checkout_payment_operation")
@Getter
@Setter
public class CheckoutPaymentOperation {

    public enum Type { CAPTURE, CANCEL }

    /** RECEIVED: accepted by Adyen; the CAPTURE or CANCELLATION webhook gives the final result. */
    public enum Status { RECEIVED, SUCCEEDED, FAILED }

    /** PLATFORM: requested from the Captures page. ADYEN: only known from a webhook (automatic capture, Customer Area). */
    public enum Origin { PLATFORM, ADYEN }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "payment_id", nullable = false)
    private CheckoutPayment payment;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Type type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Origin origin;

    /** Minor units. For a cancellation, the authorised amount that was still open. */
    private Long amount;

    private String reference;

    private String pspReference;

    private String reason;

    /** Split instructions sent with the capture (JSON list of SplitLine). */
    @Column(columnDefinition = "TEXT")
    private String splitsJson;

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
