package com.myplatform.demo.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class UserDTO {
    private Long id;
    private String email;
    private String firstName;
    private String lastName;
    private String legalEntityName;
    private String legalEntityId;
    private String accountHolderId;
    private String balanceAccountId;
    private String currencyCode;
    private String countryCode;
    private String userType;
    private Boolean bank;
    private Boolean capital;
    private Boolean issuing;
    private String activityReason;
}
