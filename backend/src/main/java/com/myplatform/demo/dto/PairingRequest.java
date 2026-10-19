package com.myplatform.demo.dto;

/** Registration of a phone as trusted device, started on the computer once the email code is entered. */
public record PairingRequest(String userId, String otpCode, String deviceName) {
}
