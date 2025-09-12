package com.myplatform.demo.model;


import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Entity
@Getter
@Setter
public class StoreCustomer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    String storeRef;
    BalanceAccountInfoCustomer balanceAccountInfoCustomer;
    List<PaymentMethodCustomer> paymentMethodCustomer;
    String country;
    String city;
    String lineAdresse;
    String phoneNumber;

    @ManyToOne
    @JoinColumn(name="user_id", nullable = true)
    private User user;


}
