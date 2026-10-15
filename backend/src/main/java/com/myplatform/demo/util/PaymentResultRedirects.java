package com.myplatform.demo.util;

import com.adyen.model.checkout.PaymentDetailsResponse;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Builds the Adyen returnUrl of checkout sessions and the frontend result page the shopper
 * lands on afterwards (/result/{success|pending|failed|error}).
 */
public final class PaymentResultRedirects {

    public static final String SOURCE_CHECKOUT = "checkout";
    public static final String SOURCE_ISSUING_CHECKOUT = "issuing-checkout";

    private static final Set<String> KNOWN_SOURCES = Set.of(SOURCE_CHECKOUT, SOURCE_ISSUING_CHECKOUT);

    private PaymentResultRedirects() {
    }

    public static String returnUrl(String backendRedirectEndpoint, String userId, String source) {
        StringBuilder url = new StringBuilder(backendRedirectEndpoint)
                .append("?source=").append(encode(source));
        if (userId != null && !userId.isBlank()) {
            url.append("&userId=").append(encode(userId));
        }
        return url.toString();
    }

    public static String resultPage(String frontendUrl, PaymentDetailsResponse response, String userId, String source) {
        PaymentDetailsResponse.ResultCodeEnum resultCode = response.getResultCode();
        String status = statusFor(resultCode);
        String reason = resultCode != null ? resultCode.getValue() : "Error";
        if ("failed".equals(status) && response.getRefusalReason() != null && !response.getRefusalReason().isBlank()) {
            reason = response.getRefusalReason();
        }
        return resultPage(frontendUrl, status, reason, userId, source);
    }

    public static String resultPage(String frontendUrl, String status, String reason, String userId, String source) {
        String base = frontendUrl != null && frontendUrl.endsWith("/")
                ? frontendUrl.substring(0, frontendUrl.length() - 1)
                : frontendUrl;
        StringBuilder url = new StringBuilder(base)
                .append("/result/").append(status)
                .append("?reason=").append(encode(reason));
        if (userId != null && !userId.isBlank()) {
            url.append("&userId=").append(encode(userId));
        }
        if (source != null && KNOWN_SOURCES.contains(source)) {
            url.append("&source=").append(source);
        }
        return url.toString();
    }

    private static String statusFor(PaymentDetailsResponse.ResultCodeEnum resultCode) {
        if (resultCode == null) {
            return "error";
        }
        return switch (resultCode) {
            case AUTHORISED, PARTIALLYAUTHORISED, SUCCESS -> "success";
            case PENDING, RECEIVED, PRESENTTOSHOPPER -> "pending";
            case REFUSED, CANCELLED -> "failed";
            default -> "error";
        };
    }

    private static String encode(String value) {
        return URLEncoder.encode(value != null ? value : "", StandardCharsets.UTF_8);
    }
}
