package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * A plan a customer pays every month or every year. Each billing cycle has its invoice: the first one is paid with a
 * payment link that stores the payment method, the next ones are charged to it. Amounts are in minor units.
 */
@Entity
@Table(name = "subscription")
@Getter
@Setter
public class Subscription {

    /**
     * Hibernate's schema update doesn't widen the check constraint it creates for an enum column, so the values of the
     * later features are listed already.
     */
    public enum Status { AWAITING_PAYMENT_METHOD, ACTIVE, PAST_DUE, CANCELLED }

    public enum Frequency {
        MONTHLY(1), YEARLY(12);

        private final int months;

        Frequency(int months) {
            this.months = months;
        }

        public int months() {
            return months;
        }
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String userId;

    @ManyToOne(optional = false)
    @JoinColumn(name = "customer_id", nullable = false)
    private Customer customer;

    @Column(nullable = false, length = 120)
    private String plan;

    /** Per cycle, excluding VAT. */
    @Column(nullable = false)
    private Long price;

    /** Percent, up to 2 decimals: 20.00, 5.50. */
    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal vatRate;

    @Column(nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Frequency frequency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Status status;

    /** The first day of the first cycle. The next cycles start on the same day of the month. */
    @Column(nullable = false)
    private LocalDate startDate;

    /** The first day of the next cycle to bill. */
    @Column(nullable = false)
    private LocalDate nextBillingDate;

    @Column(nullable = false)
    private Integer cyclesBilled;

    /** The token of the stored payment method: Adyen's recurringDetailReference. */
    private String recurringDetailReference;

    /** As Adyen names it, e.g. mc or sepadirectdebit. */
    @Column(length = 50)
    private String paymentMethodVariant;

    /** The last digits of the card or of the IBAN. */
    @Column(length = 10)
    private String paymentMethodLastDigits;

    /** MM/YYYY, for a card. */
    @Column(length = 10)
    private String paymentMethodExpiry;

    private String paymentMethodHolder;

    private Instant paymentMethodStoredAt;

    /** When Adyen was last asked for the stored payment method, so it isn't asked at each refresh. */
    private Instant paymentMethodCheckedAt;

    /** Refused card charges are retried by Adyen Auto Rescue, which the merchant account must have. */
    @Column(nullable = false)
    private boolean autoRescue;

    /** How long Auto Rescue retries a refused charge, from 1 to 48 days. */
    private Integer rescueDays;

    private Instant createdAt;

    private Instant updatedAt;

    private Instant activatedAt;

    private Instant pastDueSince;

    private Instant cancelledAt;

    /** Set on the subscriptions created by the demo data, so loading it again doesn't duplicate them. */
    @Column(length = 40)
    private String demoKey;

    @OneToMany(mappedBy = "subscription", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Fetch(FetchMode.SUBSELECT)
    @OrderBy("occurredAt ASC, id ASC")
    @Setter(AccessLevel.NONE)
    private List<SubscriptionEvent> events = new ArrayList<>();

    public SubscriptionEvent addEvent(SubscriptionEvent.Type type, Instant occurredAt, String detail, String invoiceNumber,
                                      String pspReference) {
        SubscriptionEvent event = new SubscriptionEvent();
        event.setSubscription(this);
        event.setType(type);
        event.setOccurredAt(occurredAt);
        event.setDetail(detail);
        event.setInvoiceNumber(invoiceNumber);
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
