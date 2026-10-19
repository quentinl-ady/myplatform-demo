package com.myplatform.demo.dto;

/**
 * Sent by the phone that opened the link of a remote session: the token of the link is its only credential.
 *
 * @param label    what the phone shows the computer, e.g. "iPhone · Safari" (open)
 * @param passkeys whether the phone supports passkeys (open)
 * @param kind     phone or tablet, recorded with the device (end of the registration)
 * @param platform e.g. "iPhone · Safari", recorded with the device (end of the registration)
 */
public record PhoneStepRequest(String token,
                               String sdkOutput,
                               String label,
                               Boolean passkeys,
                               String kind,
                               String platform) {
}
