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
 * A bill of a supplier, paid by a transfer from the business account or with a single-use virtual card. Amounts are
 * in minor units.
 */
@Entity
@Table(name = "bill")
@Getter
@Setter
public class Bill {

    /**
     * Overdue isn't stored: it's a bill to pay past its due date. A bill to pay again after a failed payment stays
     * FAILED until it's paid.
     */
    public enum Status { TO_PAY, PENDING_APPROVAL, PROCESSING, PAID, FAILED }

    public enum PaymentMethod { TRANSFER, CARD }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String userId;

    /** BILL-2026-0001: numbered per user and per year of issue. The reference of the transfer that pays it. */
    @Column(name = "bill_number", nullable = false, length = 20)
    private String number;

    @Column(nullable = false)
    private Integer sequenceYear;

    @Column(nullable = false)
    private Integer sequenceNumber;

    /** The number of the supplier's invoice, sent in the description of the transfer. */
    @Column(length = 40)
    private String supplierReference;

    @ManyToOne(optional = false)
    @JoinColumn(name = "supplier_id", nullable = false)
    private Supplier supplier;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
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

    /** Percent, up to 2 decimals: 20.00, 5.50. */
    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal vatRate;

    /** The expense account it's booked to, e.g. 6210. */
    @Column(nullable = false, length = 10)
    private String category;

    @Column(length = 200)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private PaymentMethod paymentMethod;

    /** The transfer that pays the bill: the bank transfer, or the payment made with its card. */
    private String transferId;

    /** As Adyen last reported it, e.g. received, authorised or booked. */
    @Column(length = 40)
    private String transferStatus;

    /** The single-use card that pays the bill. */
    private String paymentInstrumentId;

    @Column(length = 20)
    private String cardBrand;

    @Column(length = 4)
    private String cardLastFour;

    /** active until the payment is booked, then closed. */
    @Column(length = 20)
    private String cardStatus;

    /** The result of the last Verification of Payee, e.g. nameMatch or partialNameMatch. */
    @Column(length = 40)
    private String payeeCheckResult;

    /** The name the supplier's bank has, when it only partially matches. */
    @Column(length = 140)
    private String payeeCheckName;

    private Instant payeeCheckedAt;

    @Column(length = 300)
    private String failureReason;

    /** When the payment in progress was last checked at Adyen. */
    private Instant paymentCheckedAt;

    private Instant createdAt;

    private Instant updatedAt;

    private Instant paidAt;

    /** Set on the bills created by the demo data, so loading it again doesn't duplicate them. */
    @Column(length = 40)
    private String demoKey;

    @OneToMany(mappedBy = "bill", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Fetch(FetchMode.SUBSELECT)
    @OrderBy("occurredAt ASC, id ASC")
    @Setter(AccessLevel.NONE)
    private List<BillEvent> events = new ArrayList<>();

    public BillEvent addEvent(BillEvent.Type type, Instant occurredAt, String detail, String transferId) {
        BillEvent event = new BillEvent();
        event.setBill(this);
        event.setType(type);
        event.setOccurredAt(occurredAt);
        event.setDetail(detail);
        event.setTransferId(transferId);
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
