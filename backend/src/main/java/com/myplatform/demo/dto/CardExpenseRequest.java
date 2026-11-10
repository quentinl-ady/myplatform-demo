package com.myplatform.demo.dto;

import java.math.BigDecimal;

/**
 * How the user books a card payment.
 *
 * @param category the expense account, e.g. 6230
 * @param vatRate  percent, e.g. 20 or 5.5; the standard rate of the country when missing
 */
public record CardExpenseRequest(String category, BigDecimal vatRate, String note) {
}
