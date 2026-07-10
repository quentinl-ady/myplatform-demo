package com.myplatform.demo.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.User;
import com.myplatform.demo.model.WebhookEvent;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;

@RestController
@RequestMapping("/api/webhooks")
public class RelayedAuthController {

    private static final Logger log = LoggerFactory.getLogger(RelayedAuthController.class);

    private final ObjectMapper objectMapper;
    private final UserRepository userRepository;
    private final CardRepository cardRepository;
    private final WebhookEventRepository webhookEventRepository;

    public RelayedAuthController(ObjectMapper objectMapper,
                                 UserRepository userRepository,
                                 CardRepository cardRepository,
                                 WebhookEventRepository webhookEventRepository) {
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
        this.webhookEventRepository = webhookEventRepository;
    }

    @PostMapping("/relayed-auth")
    public ResponseEntity<Map<String, Object>> handleRelayedAuth(@RequestBody String rawJson) {
        long startTime = System.currentTimeMillis();
        log.info("========== RELAYED AUTH WEBHOOK RECEIVED ==========");
        log.info("[RelayedAuth] Raw payload ({} chars): {}", rawJson.length(), rawJson);

        try {
            JsonNode root = objectMapper.readTree(rawJson);
            log.info("[RelayedAuth] JSON parsed OK. Top-level fields: {}", root.fieldNames());

            JsonNode data = root.has("data") ? root.get("data") : root;
            log.info("[RelayedAuth] Using {} node. Fields: {}", root.has("data") ? "data" : "root", data.fieldNames());

            User user = resolveUser(data);
            log.info("[RelayedAuth] User resolved: {}", user != null ? "id=" + user.getId() + ", approvalPct=" + user.getApprovalPercentage() : "NULL (no user found)");
            int approvalPercentage = 100;
            if (user != null && user.getApprovalPercentage() != null) {
                approvalPercentage = user.getApprovalPercentage();
            }

            int roll = ThreadLocalRandom.current().nextInt(100);
            boolean approved = roll < approvalPercentage;
            String status = approved ? "Authorised" : "Refused";

            // Extract transaction details for the notification
            String amountStr = formatAmount(data.get("amount"));
            String merchantName = extractMerchantName(data);
            String paymentInstrumentId = extractNestedId(data, "paymentInstrument");

            // Log as WebhookEvent so it appears in Notifications
            WebhookEvent event = new WebhookEvent();
            event.setRawJson(rawJson);
            event.setSource("relayed-auth");
            event.setEventType("balancePlatform.relayedAuthorisation");
            event.setWebhookType("relayed-auth");
            event.setUserId(user != null ? user.getId() : null);
            event.setResourceId(paymentInstrumentId);
            event.setAcknowledged(false);

            if (approved) {
                event.setTitle("Relayed auth — Approved");
                event.setDescription("Transaction of " + amountStr
                        + (merchantName != null ? " at " + merchantName : "")
                        + " was approved (roll " + roll + " < " + approvalPercentage + "%).");
            } else {
                event.setTitle("Relayed auth — Refused");
                event.setDescription("Transaction of " + amountStr
                        + (merchantName != null ? " at " + merchantName : "")
                        + " was refused (roll " + roll + " >= " + approvalPercentage + "%).");
            }

            webhookEventRepository.save(event);
            log.info("[RelayedAuth] WebhookEvent saved: id={}, title={}", event.getId(), event.getTitle());

            long elapsed = System.currentTimeMillis() - startTime;
            log.info("[RelayedAuth] DECISION: status={}, approvalPercentage={}, roll={}, userId={}, elapsed={}ms",
                    status, approvalPercentage, roll, user != null ? user.getId() : "unknown", elapsed);

            Map<String, Object> responseBody = new java.util.LinkedHashMap<>();
            responseBody.put("authorisationDecision", Map.of("status", status));
            responseBody.put("metadata", Map.of(
                    "approvalPercentage", String.valueOf(approvalPercentage),
                    "source", "myplatform-demo"
            ));

            String responseJson = objectMapper.writeValueAsString(responseBody);
            log.info("[RelayedAuth] RESPONSE BODY: {}", responseJson);
            log.info("========== RELAYED AUTH RESPONSE: {} ==========", status);

            return ResponseEntity.ok(responseBody);

        } catch (Exception e) {
            long elapsed = System.currentTimeMillis() - startTime;
            log.error("[RelayedAuth] ERROR after {}ms: {} — falling back to Authorised", elapsed, e.getMessage(), e);
            log.error("[RelayedAuth] Raw payload that caused error: {}", rawJson);
            return ResponseEntity.ok(Map.of("authorisationDecision", Map.of("status", "Authorised")));
        }
    }

    private User resolveUser(JsonNode data) {
        // 1. Try to find user via paymentInstrument.id -> Card -> User
        String paymentInstrumentId = extractNestedId(data, "paymentInstrument");
        log.info("[RelayedAuth][resolveUser] paymentInstrument id={}", paymentInstrumentId);
        if (paymentInstrumentId != null) {
            Card card = cardRepository.findByPaymentInstrumentId(paymentInstrumentId);
            log.info("[RelayedAuth][resolveUser] Card lookup result: {}", card != null ? "found, userId=" + (card.getUser() != null ? card.getUser().getId() : "null") : "not found");
            if (card != null && card.getUser() != null) {
                return card.getUser();
            }
        }

        // 2. Try via accountHolder.id
        String accountHolderId = extractNestedId(data, "accountHolder");
        log.info("[RelayedAuth][resolveUser] accountHolder id={}", accountHolderId);
        if (accountHolderId != null) {
            Optional<User> user = userRepository.findByAccountHolderId(accountHolderId);
            log.info("[RelayedAuth][resolveUser] AccountHolder lookup: {}", user.isPresent() ? "found userId=" + user.get().getId() : "not found");
            if (user.isPresent()) return user.get();
        }

        // 3. Try via balanceAccount.id
        String balanceAccountId = extractNestedId(data, "balanceAccount");
        log.info("[RelayedAuth][resolveUser] balanceAccount id={}", balanceAccountId);
        if (balanceAccountId != null) {
            Optional<User> user = userRepository.findByBalanceAccountId(balanceAccountId);
            log.info("[RelayedAuth][resolveUser] BalanceAccount lookup: {}", user.isPresent() ? "found userId=" + user.get().getId() : "not found");
            if (user.isPresent()) return user.get();
        }

        log.warn("[RelayedAuth][resolveUser] Could not resolve any user from webhook data");
        return null;
    }

    private String extractNestedId(JsonNode parent, String objectFieldName) {
        if (parent == null) return null;
        JsonNode obj = parent.get(objectFieldName);
        if (obj != null && obj.isObject() && obj.has("id")) {
            return obj.get("id").asText();
        }
        if (parent.has(objectFieldName + "Id") && parent.get(objectFieldName + "Id").isTextual()) {
            return parent.get(objectFieldName + "Id").asText();
        }
        return null;
    }

    private String formatAmount(JsonNode amountNode) {
        if (amountNode == null) return "unknown amount";
        long value = amountNode.has("value") ? amountNode.get("value").asLong(0) : 0;
        String currency = amountNode.has("currency") ? amountNode.get("currency").asText("") : "";
        double major = value / 100.0;
        return String.format("%.2f %s", major, currency).trim();
    }

    private String extractMerchantName(JsonNode data) {
        JsonNode merchant = data.get("merchant");
        if (merchant != null && merchant.has("name")) {
            return merchant.get("name").asText(null);
        }
        return null;
    }
}
