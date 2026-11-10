package com.myplatform.demo.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;

/** Reads Adyen's standard notification webhooks: {"notificationItems": [{"NotificationRequestItem": {...}}]}. */
public final class AdyenNotifications {

    private AdyenNotifications() {
    }

    /** The notification items of the webhook; empty for another kind of webhook or invalid JSON. */
    public static List<JsonNode> items(ObjectMapper objectMapper, String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return List.of();
        }
        try {
            JsonNode items = objectMapper.readTree(rawJson).get("notificationItems");
            if (items == null || !items.isArray()) {
                return List.of();
            }
            List<JsonNode> result = new ArrayList<>();
            for (JsonNode wrapper : items) {
                result.add(wrapper.has("NotificationRequestItem") ? wrapper.get("NotificationRequestItem") : wrapper);
            }
            return result;
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }

    public static String text(JsonNode node, String field) {
        JsonNode value = node != null ? node.get(field) : null;
        return value != null && value.isValueNode() && !value.isNull() && !value.asText().isBlank() ? value.asText() : null;
    }

    public static String additionalData(JsonNode item, String key) {
        return item != null ? text(item.get("additionalData"), key) : null;
    }

    public static boolean success(JsonNode item) {
        return "true".equalsIgnoreCase(text(item, "success"));
    }

    public static Long amountValue(JsonNode item) {
        JsonNode value = item.path("amount").path("value");
        return value.isNumber() ? value.asLong() : null;
    }

    public static String amountCurrency(JsonNode item) {
        return text(item.path("amount"), "currency");
    }

    /** When the event happened at Adyen, null when the webhook has no valid eventDate. */
    public static Instant eventDate(JsonNode item) {
        String value = text(item, "eventDate");
        if (value == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
