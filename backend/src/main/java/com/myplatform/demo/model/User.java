package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Entity
@Getter
@Setter
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
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

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<StoreCustomer> storesCustomer;
}
