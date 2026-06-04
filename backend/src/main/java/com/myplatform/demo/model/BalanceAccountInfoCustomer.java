package com.myplatform.demo.model;

import jakarta.persistence.Transient;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class BalanceAccountInfoCustomer {
    String currencyCode;
    String description;
    String balanceAccountId;

    @Transient
    String status;
    @Transient
    List<BalanceInfo> balances;
    @Transient
    List<SweepInfo> sweeps;

    @Getter
    @Setter
    public static class BalanceInfo {
        String currency;
        long available;
        long balance;
        long pending;
        long reserved;
    }

    @Getter
    @Setter
    public static class SweepInfo {
        String id;
        String currency;
        String category;
        String description;
        String scheduleType;
        String cronExpression;
        String type;
        String status;
        String counterpartyTransferInstrumentId;
        String counterpartyBalanceAccountId;
        List<String> priorities;
    }
}
