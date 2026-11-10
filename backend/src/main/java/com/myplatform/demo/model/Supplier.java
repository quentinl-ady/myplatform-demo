package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/**
 * A supplier the user pays bills to. Its bank details are in the format of the user's currency, as the transfers of
 * the business account take them; a supplier paid by card only has none.
 */
@Entity
@Table(name = "supplier")
@Getter
@Setter
public class Supplier {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String userId;

    /** The holder of the bank account: transfers are sent to this name, and Verification of Payee checks it. */
    @Column(nullable = false, length = 100)
    private String name;

    private String email;

    @Column(length = 2)
    private String country;

    private String vatNumber;

    /** iban, accountNumberSortCode or accountNumberRoutingNumber; null without bank details. */
    @Column(length = 30)
    private String bankAccountFormat;

    @Column(length = 34)
    private String iban;

    @Column(length = 17)
    private String accountNumber;

    @Column(length = 6)
    private String sortCode;

    @Column(length = 9)
    private String routingNumber;

    /** The expense account its bills are booked to by default, e.g. 6210. */
    @Column(length = 10)
    private String defaultCategory;

    /**
     * TEST only: Adyen answers a Verification of Payee check with the result its reference names, so the check of this
     * supplier sends it, e.g. partialNameMatch. Null for a regular check.
     */
    @Column(length = 40)
    private String vopScenario;

    /** Set on the suppliers created by the demo data, so loading it again doesn't duplicate them. */
    @Column(length = 40)
    private String demoKey;

    private Instant createdAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public boolean hasBankAccount() {
        return bankAccountFormat != null;
    }
}
