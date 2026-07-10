package com.myplatform.demo.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.UserRepository;
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

    public RelayedAuthController(ObjectMapper objectMapper,
                                 UserRepository userRepository,
                                 CardRepository cardRepository) {
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
    }

    @PostMapping("/relayed-auth")
    public ResponseEntity<Map<String, Object>> handleRelayedAuth(@RequestBody String rawJson) {
        try {
            JsonNode root = objectMapper.readTree(rawJson);
            JsonNode data = root.has("data") ? root.get("data") : root;

            log.info("Relayed auth webhook received");

            User user = resolveUser(data);
            int approvalPercentage = 100;
            if (user != null && user.getApprovalPercentage() != null) {
                approvalPercentage = user.getApprovalPercentage();
            }

            int roll = ThreadLocalRandom.current().nextInt(100);
            boolean approved = roll < approvalPercentage;
            String status = approved ? "Authorised" : "Refused";

            log.info("Relayed auth decision: status={}, approvalPercentage={}, roll={}, userId={}",
                    status, approvalPercentage, roll, user != null ? user.getId() : "unknown");

            return ResponseEntity.ok(Map.of(
                    "status", status,
                    "metadata", Map.of(
                            "approvalPercentage", String.valueOf(approvalPercentage),
                            "source", "myplatform-demo"
                    )
            ));

        } catch (Exception e) {
            log.error("Error processing relayed auth webhook: {}", e.getMessage(), e);
            return ResponseEntity.ok(Map.of("status", "Authorised"));
        }
    }

    private User resolveUser(JsonNode data) {
        // 1. Try to find user via paymentInstrument.id -> Card -> User
        String paymentInstrumentId = extractNestedId(data, "paymentInstrument");
        if (paymentInstrumentId != null) {
            Card card = cardRepository.findByPaymentInstrumentId(paymentInstrumentId);
            if (card != null && card.getUser() != null) {
                return card.getUser();
            }
        }

        // 2. Try via accountHolder.id
        String accountHolderId = extractNestedId(data, "accountHolder");
        if (accountHolderId != null) {
            Optional<User> user = userRepository.findByAccountHolderId(accountHolderId);
            if (user.isPresent()) return user.get();
        }

        // 3. Try via balanceAccount.id
        String balanceAccountId = extractNestedId(data, "balanceAccount");
        if (balanceAccountId != null) {
            Optional<User> user = userRepository.findByBalanceAccountId(balanceAccountId);
            if (user.isPresent()) return user.get();
        }

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
}
