package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.security.SecureRandom;
import java.time.Instant;

/** A customer the user invoices. Its shopper reference identifies it at Adyen, e.g. for stored payment methods. */
@Entity
@Table(name = "customer")
@Getter
@Setter
public class Customer {

    private static final String ALPHANUMERIC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 10)
    private String userId;

    /** The contact person, or the customer itself when it's a consumer. */
    @Column(nullable = false)
    private String name;

    private String company;

    @Column(nullable = false)
    private String email;

    @Column(length = 2)
    private String country;

    private String vatNumber;

    private String addressLine;

    private String postalCode;

    private String city;

    /** All the users share one merchant account, so the reference includes the user id. */
    @Column(nullable = false, length = 40)
    private String shopperReference;

    /** Set on the customers created by the demo data, so loading it again doesn't duplicate them. */
    @Column(length = 40)
    private String demoKey;

    private Instant createdAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (shopperReference == null) {
            StringBuilder suffix = new StringBuilder(8);
            for (int i = 0; i < 8; i++) {
                suffix.append(ALPHANUMERIC.charAt(RANDOM.nextInt(ALPHANUMERIC.length())));
            }
            shopperReference = "CUS-" + userId + "-" + suffix;
        }
    }

    /** The company for a business customer, the person otherwise. */
    public String displayName() {
        return company != null && !company.isBlank() ? company : name;
    }
}
