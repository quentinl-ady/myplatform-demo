package com.myplatform.demo.util;

public final class EmailMask {

    private EmailMask() {
    }

    /** "quentin@example.com" -> "qu***@example.com" */
    public static String mask(String email) {
        if (email == null || !email.contains("@")) return "***";
        String[] parts = email.split("@");
        String local = parts[0];
        if (local.isEmpty()) return "***@" + parts[1];
        String masked = local.length() <= 2 ? local.charAt(0) + "***" : local.substring(0, 2) + "***";
        return masked + "@" + parts[1];
    }
}
