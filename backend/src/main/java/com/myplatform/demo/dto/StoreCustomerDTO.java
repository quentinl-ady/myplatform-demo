package com.myplatform.demo.dto;

import com.myplatform.demo.dto.BalanceAccountInfoCustomerDTO;
import com.myplatform.demo.dto.PaymentMethodCustomerDTO;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class StoreCustomerDTO {
    private String storeId;
    private String storeRef;
    private String city;
    private String country;
    private String lineAdresse;
    private String phoneNumber;
    private BalanceAccountInfoCustomerDTO balanceAccountInfoCustomer;
    private List<PaymentMethodCustomerDTO> paymentMethods;
}

