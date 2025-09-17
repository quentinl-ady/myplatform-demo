package com.myplatform.demo.model;


import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PayoutConfigurationRequest {
    public Boolean regular;
    public Boolean instant;
    public Long userId;
    public String transferInstrumentId;
    public String balanceAccountId;
    public String currencyCode;
    public String schedule; //daily weekly monthly
}
