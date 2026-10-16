package com.myplatform.demo.controller;

import com.myplatform.demo.model.WebhookEvent;
import com.myplatform.demo.service.CheckoutPaymentService;
import com.myplatform.demo.service.WebhookService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/webhooks")
public class WebhookController {

    private final WebhookService webhookService;
    private final CheckoutPaymentService checkoutPaymentService;

    public WebhookController(WebhookService webhookService, CheckoutPaymentService checkoutPaymentService) {
        this.webhookService = webhookService;
        this.checkoutPaymentService = checkoutPaymentService;
    }

    @PostMapping("/adyen")
    public ResponseEntity<String> receiveAdyenWebhook(@RequestBody String rawJson) {
        webhookService.processWebhook(rawJson, "adyen");
        checkoutPaymentService.applyWebhook(rawJson);
        return ResponseEntity.ok("[accepted]");
    }

    @PostMapping("/push")
    public ResponseEntity<WebhookEvent> pushWebhookManually(@RequestBody String rawJson) {
        WebhookEvent event = webhookService.processWebhook(rawJson, "manual");
        checkoutPaymentService.applyWebhook(rawJson);
        return ResponseEntity.ok(event);
    }

    @GetMapping("/events/{userId}")
    public ResponseEntity<List<WebhookEvent>> getEventsForUser(@PathVariable String userId) {
        return ResponseEntity.ok(webhookService.getEventsForUser(userId));
    }

    @GetMapping("/events/{userId}/unread")
    public ResponseEntity<List<WebhookEvent>> getUnreadEventsForUser(@PathVariable String userId) {
        return ResponseEntity.ok(webhookService.getUnreadEventsForUser(userId));
    }

    @GetMapping("/events/{userId}/count")
    public ResponseEntity<Map<String, Long>> countUnread(@PathVariable String userId) {
        long count = webhookService.countUnreadForUser(userId);
        return ResponseEntity.ok(Map.of("unreadCount", count));
    }

    @GetMapping("/events/{userId}/summary")
    public ResponseEntity<Map<String, Object>> getNotificationSummary(@PathVariable String userId) {
        return ResponseEntity.ok(webhookService.getNotificationSummary(userId));
    }

    @PatchMapping("/events/{eventId}/acknowledge")
    public ResponseEntity<WebhookEvent> acknowledgeEvent(@PathVariable Long eventId) {
        return ResponseEntity.ok(webhookService.acknowledgeEvent(eventId));
    }

    @PatchMapping("/events/{userId}/acknowledge-all")
    public ResponseEntity<Void> acknowledgeAll(@PathVariable String userId) {
        webhookService.acknowledgeAllForUser(userId);
        return ResponseEntity.ok().build();
    }
}
