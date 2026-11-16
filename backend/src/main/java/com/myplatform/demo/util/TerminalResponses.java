package com.myplatform.demo.util;

import com.adyen.model.clouddevice.CloudDeviceApiResponse;
import com.adyen.model.tapi.CardData;
import com.adyen.model.tapi.ErrorCondition;
import com.adyen.model.tapi.EventNotification;
import com.adyen.model.tapi.PaymentResponse;
import com.adyen.model.tapi.Response;
import com.adyen.model.tapi.ReversalResponse;
import com.adyen.model.tapi.SaleToPOIResponse;
import com.adyen.model.tapi.TransactionIDType;
import com.adyen.service.exception.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.exception.GlobalExceptionHandler;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.URLDecoder;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads the Terminal API answers to payments and refunds. When it isn't sure the card wasn't charged, the outcome is
 * UNKNOWN rather than ERROR: an error invites to try again, which could charge the card twice.
 */
public final class TerminalResponses {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern BASE64 = Pattern.compile("^[A-Za-z0-9+/]+={0,2}$");
    /** How the cloud reports a request the terminal received without answering in time. */
    private static final String NO_RESPONSE = "did not receive a response";
    private static final String LOST = "The terminal didn't answer in time. Check its screen before trying again.";

    private TerminalResponses() {
    }

    public static TerminalOutcome payment(CloudDeviceApiResponse response) {
        SaleToPOIResponse poiResponse = response != null ? response.getSaleToPOIResponse() : null;
        PaymentResponse payment = poiResponse != null ? poiResponse.getPaymentResponse() : null;
        if (payment == null) {
            return rejected(response);
        }
        Response result = payment.getResponse();
        Map<String, String> additional = additionalResponse(result != null ? result.getAdditionalResponse() : null);
        TransactionIDType transaction = payment.getPoiData() != null ? payment.getPoiData().getPoITransactionID() : null;
        CardData card = payment.getPaymentResult() != null && payment.getPaymentResult().getPaymentInstrumentData() != null
                ? payment.getPaymentResult().getPaymentInstrumentData().getCardData()
                : null;
        String brand = firstNonBlank(card != null ? card.getPaymentBrand() : null, additional.get("paymentMethod"));
        String maskedPan = firstNonBlank(card != null ? card.getMaskedPan() : null, additional.get("cardSummary"));
        return outcome(classify(result, additional, false), transaction, additional, brand, maskedPan);
    }

    public static TerminalOutcome reversal(CloudDeviceApiResponse response) {
        SaleToPOIResponse poiResponse = response != null ? response.getSaleToPOIResponse() : null;
        ReversalResponse reversal = poiResponse != null ? poiResponse.getReversalResponse() : null;
        if (reversal == null) {
            return rejected(response);
        }
        Response result = reversal.getResponse();
        Map<String, String> additional = additionalResponse(result != null ? result.getAdditionalResponse() : null);
        TransactionIDType transaction = reversal.getPoiData() != null ? reversal.getPoiData().getPoITransactionID() : null;
        return outcome(classify(result, additional, true), transaction, additional, null, null);
    }

    /** Adyen rejected the request. A client error never reached the terminal; after a server error, nobody knows. */
    public static TerminalOutcome failure(ApiException e) {
        int status = e.getStatusCode();
        if (status >= 400 && status < 500) {
            String message = GlobalExceptionHandler.messageFromBody(e.getResponseBody());
            return TerminalOutcome.of(TerminalOutcome.Result.ERROR, sentence("The terminal couldn't be reached", message));
        }
        return TerminalOutcome.of(TerminalOutcome.Result.UNKNOWN, LOST);
    }

    /** The request couldn't be sent, or its answer didn't arrive. */
    public static TerminalOutcome lost(IOException e) {
        if (e instanceof ConnectException || e instanceof UnknownHostException || e instanceof NoRouteToHostException
                || "ConnectTimeoutException".equals(e.getClass().getSimpleName())) {
            return TerminalOutcome.of(TerminalOutcome.Result.ERROR,
                    "Couldn't reach the payment platform. Check the connection and try again.");
        }
        return TerminalOutcome.of(TerminalOutcome.Result.UNKNOWN, LOST);
    }

    /**
     * The key/value pairs of an AdditionalResponse or of EventDetails: URL-encoded ("message=Card+blocked"), or
     * Base64-encoded JSON, whose nested objects are flattened. A plain text is the message.
     */
    public static Map<String, String> additionalResponse(String raw) {
        String value = trimToNull(raw);
        if (value == null) {
            return Map.of();
        }
        if (value.length() % 4 == 0 && BASE64.matcher(value).matches()) {
            Map<String, String> json = base64Json(value);
            if (json != null) {
                return json;
            }
        }
        Map<String, String> pairs = new LinkedHashMap<>();
        for (String pair : value.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                String text = trimToNull(decode(pair.substring(eq + 1)));
                if (text != null) {
                    pairs.putIfAbsent(decode(pair.substring(0, eq)), text);
                }
            }
        }
        if (pairs.isEmpty() && value.indexOf('=') < 0) {
            pairs.put("message", value);
        }
        return pairs;
    }

    /** The PSP reference of a transaction of a terminal, "tender.pspReference", else of the additional response. */
    static String pspReference(TransactionIDType transaction, Map<String, String> additional) {
        String id = transaction != null ? trimToNull(transaction.getTransactionID()) : null;
        if (id != null) {
            String psp = trimToNull(id.substring(id.lastIndexOf('.') + 1));
            if (psp != null) {
                return psp;
            }
        }
        return additional.get("pspReference");
    }

    private record Classified(TerminalOutcome.Result result, String message, String reason) {

        Classified(TerminalOutcome.Result result, String message) {
            this(result, message, null);
        }
    }

    private static TerminalOutcome outcome(Classified classified, TransactionIDType transaction,
                                           Map<String, String> additional, String brand, String maskedPan) {
        return new TerminalOutcome(classified.result(), classified.message(), classified.reason(),
                pspReference(transaction, additional),
                transaction != null ? trimToNull(transaction.getTransactionID()) : null,
                transaction != null && transaction.getTimeStamp() != null ? transaction.getTimeStamp().toInstant() : null,
                brand != null ? brand.toLowerCase(Locale.ROOT) : null, maskedPan);
    }

    private static Classified classify(Response response, Map<String, String> additional, boolean refund) {
        String what = refund ? "refund" : "payment";
        if (response == null || response.getResult() == null) {
            return new Classified(TerminalOutcome.Result.UNKNOWN,
                    "The terminal's answer has no result. Check the " + what + " before trying again.");
        }
        switch (response.getResult()) {
            case SUCCESS -> {
                return new Classified(TerminalOutcome.Result.APPROVED, null);
            }
            case PARTIAL -> {
                return new Classified(TerminalOutcome.Result.UNKNOWN,
                        "The terminal approved only part of the amount. Check the " + what + " before trying again.");
            }
            default -> {
            }
        }
        ErrorCondition condition = response.getErrorCondition();
        String reason = firstNonBlank(firstNonBlank(additional.get("refusalReason"), additional.get("message")),
                condition == ErrorCondition.WRONG_PIN ? "Wrong PIN" : null);
        if (condition == null) {
            return new Classified(TerminalOutcome.Result.ERROR, sentence("The terminal couldn't make the " + what, reason),
                    reason);
        }
        return switch (condition) {
            case REFUSAL, WRONG_PIN, INVALID_CARD, PAYMENT_RESTRICTION, NOT_ALLOWED -> new Classified(
                    TerminalOutcome.Result.DECLINED,
                    sentence(refund ? "The refund was refused" : "Declined", reason), reason);
            case ABORTED, CANCEL -> new Classified(TerminalOutcome.Result.CANCELLED, condition == ErrorCondition.CANCEL
                    ? "The " + what + " was cancelled at the terminal."
                    : "The " + what + " was cancelled.", reason);
            case BUSY, IN_PROGRESS -> new Classified(TerminalOutcome.Result.ERROR,
                    "The terminal is busy with another transaction. Try again once it's done.", reason);
            case DEVICE_OUT, UNAVAILABLE_DEVICE, LOGGED_OUT -> new Classified(TerminalOutcome.Result.ERROR,
                    "The terminal isn't available. Check that it's on and connected.", reason);
            case UNREACHABLE_HOST -> new Classified(TerminalOutcome.Result.ERROR,
                    "The terminal couldn't reach the payment platform.", reason);
            default -> new Classified(TerminalOutcome.Result.ERROR,
                    sentence("The terminal couldn't make the " + what, reason), reason);
        };
    }

    /** The answer of the cloud when the terminal didn't answer the request, or didn't get it. */
    private static TerminalOutcome rejected(CloudDeviceApiResponse response) {
        EventNotification event = response != null && response.getSaleToPOIRequest() != null
                ? response.getSaleToPOIRequest().getEventNotification()
                : null;
        if (event == null) {
            return TerminalOutcome.of(TerminalOutcome.Result.UNKNOWN,
                    "The terminal's answer couldn't be read. Check its screen before trying again.");
        }
        String message = additionalResponse(event.getEventDetails()).get("message");
        if (message != null && message.toLowerCase(Locale.ROOT).contains(NO_RESPONSE)) {
            return TerminalOutcome.of(TerminalOutcome.Result.UNKNOWN, LOST);
        }
        return TerminalOutcome.of(TerminalOutcome.Result.ERROR, sentence("The terminal couldn't be reached", message));
    }

    private static Map<String, String> base64Json(String value) {
        try {
            JsonNode root = MAPPER.readTree(Base64.getDecoder().decode(value));
            if (root == null || !root.isObject()) {
                return null;
            }
            Map<String, String> fields = new LinkedHashMap<>();
            flatten(root, fields);
            return fields;
        } catch (IllegalArgumentException | IOException e) {
            return null;
        }
    }

    private static void flatten(JsonNode node, Map<String, String> fields) {
        for (Iterator<Map.Entry<String, JsonNode>> it = node.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> field = it.next();
            JsonNode value = field.getValue();
            if (value.isObject()) {
                flatten(value, fields);
            } else if (value.isValueNode() && !value.isNull() && !value.asText().isBlank()) {
                fields.putIfAbsent(field.getKey(), value.asText());
            }
        }
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return value;
        }
    }

    /** "Declined: Not enough balance." */
    private static String sentence(String start, String detail) {
        String text = trimToNull(detail);
        if (text == null) {
            return start + ".";
        }
        return start + ": " + text + (text.endsWith(".") ? "" : ".");
    }

    private static String firstNonBlank(String first, String second) {
        String value = trimToNull(first);
        return value != null ? value : trimToNull(second);
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
