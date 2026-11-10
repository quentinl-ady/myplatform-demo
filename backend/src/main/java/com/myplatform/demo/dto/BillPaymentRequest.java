package com.myplatform.demo.dto;

import java.util.List;

/** @param transferType regular when null, fast or instant */
public record BillPaymentRequest(List<Long> billIds, String transferType) {
}
