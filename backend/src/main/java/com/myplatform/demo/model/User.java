package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.security.SecureRandom;
import java.util.List;

@Entity
@Table(name = "\"user\"")
@Getter
@Setter
public class User {
    private static final String ALPHANUMERIC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @Id
    @Column(length = 10)
    private String id;

    @PrePersist
    public void generateId() {
        if (this.id == null) {
            StringBuilder sb = new StringBuilder(10);
            for (int i = 0; i < 10; i++) {
                sb.append(ALPHANUMERIC.charAt(RANDOM.nextInt(ALPHANUMERIC.length())));
            }
            this.id = sb.toString();
        }
    }
    private String email;
    private String password;
    private String legalEntityName; //mapping 1-1 AH <-> LE <-> BA
    private String countryCode;
    private String userType;
    private String legalEntityId;
    private String firstName;
    private String lastName;
    private String accountHolderId; //mapping 1-1 AH <-> LE <-> BA
    private String currencyCode;
    private String balanceAccountId; //mapping 1-1 AH <-> LE <-> BA
    private String activityReason;
    private Boolean bank;
    private Boolean capital;
    private Boolean issuing;
    private String bankAccountId;
    private String bankAccountNumber;

    @Column(columnDefinition = "integer default 100")
    private Integer approvalPercentage = 100;

    @Transient
    private List<Activity> businessActivities;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<StoreCustomer> storesCustomer;
}
