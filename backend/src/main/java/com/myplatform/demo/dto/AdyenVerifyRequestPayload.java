package com.myplatform.demo.dto;


import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.*;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class AdyenVerifyRequestPayload {

    private Counterparty counterparty;
    private String reference;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Counterparty {
        private BankAccount bankAccount;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BankAccount {
        private AccountHolder accountHolder;
        private AccountIdentification accountIdentification;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AccountHolder {
        private String fullName;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class AccountIdentification {
        private String type;
        private String iban;
        private String accountNumber;
        private String sortCode;
        private String accountType;
    }
}
