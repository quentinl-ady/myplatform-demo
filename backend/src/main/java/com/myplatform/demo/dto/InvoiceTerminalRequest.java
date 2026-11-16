package com.myplatform.demo.dto;

/** @param terminalId the POIID of the terminal, e.g. "S1F2-000158234567890" */
public record InvoiceTerminalRequest(String terminalId) {
}
