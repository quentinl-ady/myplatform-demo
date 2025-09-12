package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
public class PaymentMethodCustomer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    String type;
    String verificationStatus;

    @ManyToOne
    @JoinColumn(name = "store_customer_id")
    private StoreCustomer storeCustomer;

}
