package com.myplatform.demo.model;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

@Getter
@AllArgsConstructor
public class TransferRouteOption {
    private String priority;
    // Amount limits in minor units, null when Adyen does not set one.
    private Long minAmount;
    private Long maxAmount;
    private boolean wholeAmountsOnly;
    private List<String> requirements;
}
