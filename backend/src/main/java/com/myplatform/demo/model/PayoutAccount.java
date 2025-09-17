package com.myplatform.demo.model;


import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class PayoutAccount {
    private String transferInstrumentId;
    private String accountIdentifier;
}
