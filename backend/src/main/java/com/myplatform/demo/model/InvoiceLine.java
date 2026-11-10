package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

/** A line of an invoice. Amounts are in minor units; the VAT is rounded per line. */
@Entity
@Table(name = "invoice_line")
@Getter
@Setter
public class InvoiceLine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "invoice_id", nullable = false)
    private Invoice invoice;

    @Column(nullable = false)
    private Integer sortOrder;

    @Column(nullable = false, length = 200)
    private String description;

    @Column(nullable = false)
    private Long quantity;

    /** Excluding VAT. */
    @Column(nullable = false)
    private Long unitPrice;

    /** Percent, up to 2 decimals: 20.00, 5.50. */
    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal vatRate;

    @Column(nullable = false)
    private Long netAmount;

    @Column(nullable = false)
    private Long taxAmount;

    @Column(nullable = false)
    private Long grossAmount;
}
