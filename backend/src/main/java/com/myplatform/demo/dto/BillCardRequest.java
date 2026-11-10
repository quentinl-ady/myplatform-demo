package com.myplatform.demo.dto;

/** @param brand the network of the single-use card, visa or mc; the first one configured when null */
public record BillCardRequest(String brand) {
}
