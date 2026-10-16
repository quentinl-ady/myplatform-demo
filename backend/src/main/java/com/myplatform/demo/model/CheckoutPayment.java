package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Checkout payment authorised with delayed or manual capture, listed on the Captures page.
 * Captures and cancellations are stored as operations.
 */
@Entity
@Table(name = "checkout_payment")
@Getter
@Setter
public class CheckoutPayment {

    public enum Channel { DROPIN, SAVED_CARD }

    /** Authorisation result. CREATED: the checkout session exists but no result is known yet. */
    public enum Status { CREATED, AUTHORISED, PENDING, REFUSED, NOT_COMPLETED, ERROR }

    public enum CaptureMode { IMMEDIATE, DELAYED, MANUAL }

    public enum SplitMode {
        /** No split instructions: Adyen books the funds to the liable balance account. */
        NONE,
        /** The split configuration profile of the store applies. */
        STORE_PROFILE,
        /** Explicit split with the default marketplace commission. */
        MARKETPLACE_DEFAULT,
        /** Explicit split chosen in the advanced checkout options. */
        CUSTOM
    }

    @Id
    @Column(length = 36)
    private String id;

    /** Platform user whose Captures page lists the payment. */
    @Column(nullable = false)
    private String ownerUserId;

    /** Platform user whose balance account receives the funds (the issuing test merchant for issuing tests). */
    private String subMerchantUserId;

    /** PaymentResultRedirects.SOURCE_CHECKOUT or SOURCE_ISSUING_CHECKOUT; selects the API credentials. */
    @Column(nullable = false)
    private String source;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Channel channel;

    @Column(nullable = false)
    private String merchantAccount;

    private String merchantReference;

    private String storeReference;

    private String balanceAccountId;

    private String sessionId;

    private String pspReference;

    @Column(nullable = false)
    private Long amount;

    @Column(nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status;

    private String resultCode;

    private String refusalReason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CaptureMode captureMode;

    private Integer captureDelayHours;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SplitMode splitMode;

    /** Null for NONE and STORE_PROFILE. */
    @Embedded
    private SplitSettings splitSettings;

    /** Split instructions sent with the authorisation (JSON list of SplitLine). */
    @Column(columnDefinition = "TEXT")
    private String splitsJson;

    private Instant createdAt;

    private Instant authorisedAt;

    private Instant updatedAt;

    @OneToMany(mappedBy = "payment", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("createdAt ASC")
    private List<CheckoutPaymentOperation> operations = new ArrayList<>();

    public void addOperation(CheckoutPaymentOperation operation) {
        operation.setPayment(this);
        operations.add(operation);
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
