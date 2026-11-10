package com.myplatform.demo.controller;

import com.myplatform.demo.dto.SubscriptionChargeRequest;
import com.myplatform.demo.dto.SubscriptionDTO;
import com.myplatform.demo.dto.SubscriptionRequest;
import com.myplatform.demo.dto.SubscriptionSettingsDTO;
import com.myplatform.demo.service.SubscriptionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Subscriptions: an invoice per billing cycle, charged to the payment method the customer stored with the first one. */
@RestController
@RequestMapping("/api/subscriptions")
public class SubscriptionController {

    private final SubscriptionService subscriptionService;

    public SubscriptionController(SubscriptionService subscriptionService) {
        this.subscriptionService = subscriptionService;
    }

    /** The currency, tax rates and Auto Rescue options the subscription form needs. */
    @GetMapping("/{userId}/settings")
    public ResponseEntity<SubscriptionSettingsDTO> settings(@PathVariable String userId) {
        return ResponseEntity.ok(subscriptionService.settings(userId));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<SubscriptionDTO>> list(@PathVariable String userId) {
        return ResponseEntity.ok(subscriptionService.list(userId));
    }

    @GetMapping("/{userId}/{subscriptionId}")
    public ResponseEntity<SubscriptionDTO> get(@PathVariable String userId, @PathVariable Long subscriptionId) {
        return ResponseEntity.ok(subscriptionService.get(userId, subscriptionId));
    }

    /** Creates the subscription and sends its first invoice with a payment link that stores the payment method. */
    @PostMapping("/{userId}")
    public ResponseEntity<SubscriptionDTO> create(@PathVariable String userId, @RequestBody SubscriptionRequest request) {
        return ResponseEntity.ok(subscriptionService.create(userId, request));
    }

    /** Bills the next cycle and charges it, or charges the refused invoice of the last cycle again. */
    @PostMapping("/{userId}/{subscriptionId}/run-cycle")
    public ResponseEntity<SubscriptionDTO> runCycle(@PathVariable String userId, @PathVariable Long subscriptionId,
                                                    @RequestBody(required = false) SubscriptionChargeRequest request)
            throws Exception {
        return ResponseEntity.ok(subscriptionService.runCycle(userId, subscriptionId, request));
    }

    @PostMapping("/{userId}/{subscriptionId}/stop-rescue")
    public ResponseEntity<SubscriptionDTO> stopRescue(@PathVariable String userId, @PathVariable Long subscriptionId)
            throws Exception {
        return ResponseEntity.ok(subscriptionService.stopRescue(userId, subscriptionId));
    }

    @PostMapping("/{userId}/{subscriptionId}/cancel")
    public ResponseEntity<SubscriptionDTO> cancel(@PathVariable String userId, @PathVariable Long subscriptionId)
            throws Exception {
        return ResponseEntity.ok(subscriptionService.cancel(userId, subscriptionId));
    }
}
