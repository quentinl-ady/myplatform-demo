package com.myplatform.demo.dto;

/**
 * A receipt as the browser read it.
 *
 * @param data the file in base64, or as a data URL
 */
public record ReceiptUploadRequest(String fileName, String data) {
}
