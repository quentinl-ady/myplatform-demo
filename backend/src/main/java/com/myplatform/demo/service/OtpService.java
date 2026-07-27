package com.myplatform.demo.service;

import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OtpService {

    private static final int OTP_LENGTH = 6;
    private static final long EXPIRATION_SECONDS = 5 * 60;
    private static final SecureRandom RANDOM = new SecureRandom();

    private record OtpEntry(String code, Instant expiresAt) {}

    private final ConcurrentHashMap<String, OtpEntry> otpStore = new ConcurrentHashMap<>();

    public String generateOtp(String userId) {
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        otpStore.put(userId, new OtpEntry(code, Instant.now().plusSeconds(EXPIRATION_SECONDS)));
        return code;
    }

    public boolean verifyOtp(String userId, String code) {
        OtpEntry entry = otpStore.get(userId);
        if (entry == null) return false;
        if (Instant.now().isAfter(entry.expiresAt())) {
            otpStore.remove(userId);
            return false;
        }
        if (entry.code().equals(code)) {
            otpStore.remove(userId);
            return true;
        }
        return false;
    }
}
