package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.model.User;
import com.myplatform.demo.model.WebhookEvent;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class WebhookService {

    private static final Logger log = LoggerFactory.getLogger(WebhookService.class);

    private final WebhookEventRepository webhookEventRepository;
    private final UserRepository userRepository;
    private final StoreCustomerRepository storeCustomerRepository;
    private final ObjectMapper objectMapper;

    public WebhookService(WebhookEventRepository webhookEventRepository,
                          UserRepository userRepository,
                          StoreCustomerRepository storeCustomerRepository,
                          ObjectMapper objectMapper) {
        this.webhookEventRepository = webhookEventRepository;
        this.userRepository = userRepository;
        this.storeCustomerRepository = storeCustomerRepository;
        this.objectMapper = objectMapper;
    }

    public WebhookEvent processWebhook(String rawJson, String source) {
        WebhookEvent event = new WebhookEvent();
        event.setRawJson(rawJson);
        event.setSource(source);
        event.setAcknowledged(false);

        try {
            JsonNode root = objectMapper.readTree(rawJson);

            String eventType = extractText(root, "type");
            if (eventType == null) {
                eventType = extractText(root, "eventCode");
            }
            if (eventType == null) {
                JsonNode notifItem = extractStandardNotificationItem(root);
                if (notifItem != null) {
                    eventType = extractText(notifItem, "eventCode");
                }
            }
            event.setEventType(eventType != null ? eventType : "UNKNOWN");

            String webhookType = detectWebhookType(root);
            event.setWebhookType(webhookType);

            String userId = resolveUserId(root);
            event.setUserId(userId);

            String resourceId = extractResourceId(root);
            event.setResourceId(resourceId);

            generateNotificationText(event, root);

        } catch (Exception e) {
            log.warn("Failed to parse webhook JSON: {}", e.getMessage());
            event.setEventType("PARSE_ERROR");
            event.setWebhookType("unknown");
        }

        WebhookEvent saved = webhookEventRepository.save(event);
        log.info("Webhook event saved: id={}, type={}, webhookType={}, userId={}, source={}",
                saved.getId(), saved.getEventType(), saved.getWebhookType(), saved.getUserId(), saved.getSource());
        return saved;
    }

    public List<WebhookEvent> getEventsForUser(String userId) {
        return webhookEventRepository.findByUserIdOrderByReceivedAtDesc(userId);
    }

    public List<WebhookEvent> getUnreadEventsForUser(String userId) {
        return webhookEventRepository.findByUserIdAndAcknowledgedFalseOrderByReceivedAtDesc(userId);
    }

    public long countUnreadForUser(String userId) {
        return webhookEventRepository.countByUserIdAndAcknowledgedFalse(userId);
    }

    public WebhookEvent acknowledgeEvent(Long eventId) {
        WebhookEvent event = webhookEventRepository.findById(eventId)
                .orElseThrow(() -> new RuntimeException("Webhook event not found: " + eventId));
        event.setAcknowledged(true);
        return webhookEventRepository.save(event);
    }

    public void acknowledgeAllForUser(String userId) {
        List<WebhookEvent> unread = webhookEventRepository.findByUserIdAndAcknowledgedFalseOrderByReceivedAtDesc(userId);
        unread.forEach(e -> e.setAcknowledged(true));
        webhookEventRepository.saveAll(unread);
    }

    public Map<String, Object> getNotificationSummary(String userId) {
        long unreadCount = countUnreadForUser(userId);
        List<WebhookEvent> recent = webhookEventRepository.findByUserIdAndAcknowledgedFalseOrderByReceivedAtDesc(userId);
        List<WebhookEvent> top5 = recent.stream().limit(5).toList();
        return Map.of(
                "unreadCount", unreadCount,
                "recentEvents", top5
        );
    }

    private void generateNotificationText(WebhookEvent event, JsonNode root) {
        String eventType = event.getEventType();
        JsonNode data = root.has("data") ? root.get("data") : root;

        switch (eventType) {

            // ── Transfer webhooks ──
            case "balancePlatform.transfer.created":
            case "balancePlatform.transfer.updated": {
                String status = extractText(data, "status");
                String direction = extractText(data, "direction");
                String amountStr = formatAmount(data.get("amount"));
                String category = extractText(data, "category");
                boolean isCreated = eventType.endsWith(".created");

                if ("incoming".equals(direction)) {
                    event.setTitle("Incoming fund transfer" + (isCreated ? "" : " updated"));
                    event.setDescription("Incoming transfer of " + amountStr +
                            statusSuffix(status) + categoryHint(category));
                } else {
                    event.setTitle("Outgoing fund transfer" + (isCreated ? "" : " updated"));
                    event.setDescription("Outgoing transfer of " + amountStr +
                            statusSuffix(status) + categoryHint(category));
                }
                break;
            }

            // ── Transaction webhooks ──
            case "balancePlatform.transaction.created": {
                String amountStr = formatAmount(data.get("amount"));
                event.setTitle("New transaction");
                event.setDescription("Transaction of " + amountStr + " recorded.");
                break;
            }

            // ── Account Holder ──
            case "balancePlatform.accountHolder.created": {
                String desc = extractText(data, "description");
                event.setTitle("Account holder created");
                event.setDescription("A new account holder has been created" +
                        (desc != null ? " (" + desc + ")" : "") + ".");
                break;
            }
            case "balancePlatform.accountHolder.updated": {
                String status = extractText(data, "status");
                event.setTitle("Account holder updated");
                event.setDescription("Account holder status changed" +
                        (status != null ? " to " + status : "") + ".");
                break;
            }

            // ── Balance Account ──
            case "balancePlatform.balanceAccount.created": {
                String desc = extractText(data, "description");
                event.setTitle("Balance account created");
                event.setDescription("A new balance account has been created" +
                        (desc != null ? " (" + desc + ")" : "") + ".");
                break;
            }
            case "balancePlatform.balanceAccount.updated": {
                String status = extractText(data, "status");
                event.setTitle("Balance account updated");
                event.setDescription("Balance account" +
                        (status != null ? " is now " + status : " has been updated") + ".");
                break;
            }

            // ── Payment Instrument ──
            case "balancePlatform.paymentInstrument.created": {
                String piType = extractText(data, "type");
                event.setTitle("Payment instrument created");
                event.setDescription("A new " +
                        ("card".equals(piType) ? "card" : "bank account") +
                        " has been issued.");
                break;
            }
            case "balancePlatform.paymentInstrument.updated": {
                String status = extractText(data, "status");
                String piType = extractText(data, "type");
                String label = "card".equals(piType) ? "Card" : "Payment instrument";
                event.setTitle(label + " updated");
                event.setDescription(label + (status != null ? " is now " + status : " has been updated") + ".");
                break;
            }

            // ── KYC / Verification ──
            case "balancePlatform.accountHolder.verification": {
                event.setTitle("KYC verification update");
                event.setDescription("Identity verification status has been updated.");
                break;
            }

            // ── Sweep ──
            case "balancePlatform.balanceAccountSweep.created":
            case "balancePlatform.balanceAccountSweep.updated":
            case "balancePlatform.balanceAccountSweep.deleted": {
                String action = eventType.endsWith(".created") ? "created" :
                        eventType.endsWith(".deleted") ? "deleted" : "updated";
                event.setTitle("Sweep configuration " + action);
                event.setDescription("Automatic sweep/payout configuration has been " + action + ".");
                break;
            }

            // ── Standard payment notifications ──
            case "AUTHORISATION": {
                JsonNode notifItem = extractStandardNotificationItem(root);
                String amountStr = notifItem != null ? formatAmount(notifItem.get("amount")) : "unknown";
                String success = notifItem != null ? extractText(notifItem, "success") : null;
                String paymentMethod = notifItem != null ? extractText(notifItem, "paymentMethod") : null;
                boolean ok = "true".equals(success);
                event.setTitle(ok ? "Payment authorised" : "Payment refused");
                event.setDescription("Payment of " + amountStr +
                        (ok ? " has been authorised" : " was refused") +
                        (paymentMethod != null ? " (" + paymentMethod.toUpperCase() + ")" : "") + ".");
                break;
            }
            case "CAPTURE": {
                JsonNode notifItem = extractStandardNotificationItem(root);
                String amountStr = notifItem != null ? formatAmount(notifItem.get("amount")) : "unknown";
                event.setTitle("Payment captured");
                event.setDescription("Payment of " + amountStr + " has been captured.");
                break;
            }
            case "REFUND": {
                JsonNode notifItem = extractStandardNotificationItem(root);
                String amountStr = notifItem != null ? formatAmount(notifItem.get("amount")) : "unknown";
                event.setTitle("Refund processed");
                event.setDescription("Refund of " + amountStr + " has been processed.");
                break;
            }
            case "CANCELLATION": {
                event.setTitle("Payment cancelled");
                event.setDescription("A payment has been cancelled.");
                break;
            }
            case "CHARGEBACK": {
                JsonNode notifItem = extractStandardNotificationItem(root);
                String amountStr = notifItem != null ? formatAmount(notifItem.get("amount")) : "unknown";
                event.setTitle("Chargeback received");
                event.setDescription("A chargeback of " + amountStr + " has been raised.");
                break;
            }
            case "PAYOUT_THIRDPARTY": {
                JsonNode notifItem = extractStandardNotificationItem(root);
                String amountStr = notifItem != null ? formatAmount(notifItem.get("amount")) : "unknown";
                event.setTitle("Payout sent");
                event.setDescription("A payout of " + amountStr + " has been sent.");
                break;
            }

            default: {
                String humanType = eventType.replace("balancePlatform.", "")
                        .replace(".", " — ");
                event.setTitle("Notification");
                event.setDescription(humanType);
                break;
            }
        }
    }

    private String formatAmount(JsonNode amountNode) {
        if (amountNode == null) return "unknown amount";
        long value = amountNode.has("value") ? amountNode.get("value").asLong(0) : 0;
        String currency = amountNode.has("currency") ? amountNode.get("currency").asText("") : "";
        double major = value / 100.0;
        return String.format("%.2f %s", major, currency).trim();
    }

    private String statusSuffix(String status) {
        if (status == null) return "";
        return switch (status) {
            case "captured" -> " — captured";
            case "booked" -> " — booked";
            case "authorised" -> " — authorised";
            case "pendingApproval" -> " — pending approval";
            case "refused" -> " — refused";
            case "failed" -> " — failed";
            case "received" -> " — received";
            default -> " — " + status;
        };
    }

    private String categoryHint(String category) {
        if (category == null) return ".";
        return switch (category) {
            case "platformPayment" -> " (platform payment).";
            case "bank" -> " (bank transfer).";
            case "internal" -> " (internal transfer).";
            case "issuedCard" -> " (card transaction).";
            default -> ".";
        };
    }

    private String detectWebhookType(JsonNode root) {
        if (root.has("type")) {
            String type = root.get("type").asText("");
            if (type.startsWith("balancePlatform.transfer")) return "transfer";
            if (type.startsWith("balancePlatform.transaction")) return "transaction";
            if (type.startsWith("balancePlatform.")) return "configuration";
        }
        if (root.has("eventCode")) return "standard";
        if (root.has("notificationItems")) return "standard";
        return "unknown";
    }

    private String resolveUserId(JsonNode root) {
        JsonNode data = root.has("data") ? root.get("data") : root;

        // 1. Balance Platform webhooks: data.accountHolder.id
        String accountHolderId = extractNestedId(data, "accountHolder");
        if (accountHolderId == null) {
            accountHolderId = deepSearch(data, "accountHolderId");
        }
        if (accountHolderId != null) {
            Optional<User> user = userRepository.findByAccountHolderId(accountHolderId);
            if (user.isPresent()) return user.get().getId();
        }

        // 2. Balance Platform webhooks: data.balanceAccount.id
        String balanceAccountId = extractNestedId(data, "balanceAccount");
        if (balanceAccountId == null) {
            balanceAccountId = deepSearch(data, "balanceAccountId");
        }
        if (balanceAccountId != null) {
            Optional<User> user = userRepository.findByBalanceAccountId(balanceAccountId);
            if (user.isPresent()) return user.get().getId();
        }

        // 3. Balance Platform webhooks: data.accountHolder.reference (can be the user id)
        String accountHolderRef = extractNestedField(data, "accountHolder", "reference");
        if (accountHolderRef != null) {
            Optional<User> user = userRepository.findById(accountHolderRef);
            if (user.isPresent()) return user.get().getId();
        }

        // 4. Standard notifications: notificationItems[].NotificationRequestItem
        JsonNode notificationItem = extractStandardNotificationItem(root);
        if (notificationItem != null) {
            // Try additionalData.store (storeRef)
            JsonNode additionalData = notificationItem.get("additionalData");
            if (additionalData != null) {
                String storeRef = extractText(additionalData, "store");
                if (storeRef != null) {
                    StoreCustomer store = storeCustomerRepository.findByStoreRef(storeRef);
                    if (store != null && store.getUser() != null) {
                        return store.getUser().getId();
                    }
                }
            }
            // Try merchantReference as userId
            String merchantReference = extractText(notificationItem, "merchantReference");
            if (merchantReference != null) {
                Optional<User> user = userRepository.findById(merchantReference);
                if (user.isPresent()) return user.get().getId();
            }
        }

        // 5. Fallback: merchantReference anywhere in the payload
        String merchantReference = deepSearch(data, "merchantReference");
        if (merchantReference != null) {
            Optional<User> user = userRepository.findById(merchantReference);
            if (user.isPresent()) return user.get().getId();
        }

        // 6. Fallback: storeId
        String storeId = deepSearch(data, "storeId");
        if (storeId != null) {
            Optional<StoreCustomer> store = storeCustomerRepository.findByStoreId(storeId);
            if (store.isPresent() && store.get().getUser() != null) {
                return store.get().getUser().getId();
            }
        }

        return null;
    }

    private String extractNestedId(JsonNode parent, String objectFieldName) {
        if (parent == null) return null;
        JsonNode obj = parent.get(objectFieldName);
        if (obj != null && obj.isObject()) {
            return extractText(obj, "id");
        }
        return null;
    }

    private String extractNestedField(JsonNode parent, String objectFieldName, String fieldName) {
        if (parent == null) return null;
        JsonNode obj = parent.get(objectFieldName);
        if (obj != null && obj.isObject()) {
            return extractText(obj, fieldName);
        }
        return null;
    }

    private JsonNode extractStandardNotificationItem(JsonNode root) {
        JsonNode items = root.get("notificationItems");
        if (items != null && items.isArray() && !items.isEmpty()) {
            JsonNode first = items.get(0);
            if (first.has("NotificationRequestItem")) {
                return first.get("NotificationRequestItem");
            }
            return first;
        }
        return null;
    }

    private String extractResourceId(JsonNode root) {
        JsonNode data = root.has("data") ? root.get("data") : root;
        String id = extractText(data, "id");
        if (id != null) return id;
        id = extractText(data, "pspReference");
        if (id != null) return id;

        JsonNode notificationItem = extractStandardNotificationItem(root);
        if (notificationItem != null) {
            return extractText(notificationItem, "pspReference");
        }
        return null;
    }

    private String extractText(JsonNode node, String field) {
        if (node == null) return null;
        JsonNode child = node.get(field);
        if (child != null && child.isTextual()) return child.asText();
        return null;
    }

    private String deepSearch(JsonNode node, String fieldName) {
        if (node == null) return null;
        if (node.has(fieldName) && node.get(fieldName).isTextual()) {
            return node.get(fieldName).asText();
        }
        for (JsonNode child : node) {
            if (child.isObject()) {
                String result = deepSearch(child, fieldName);
                if (result != null) return result;
            }
        }
        return null;
    }
}
