package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.util.AdyenNotifications;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * Applies the Adyen webhooks to the invoicing documents: the invoices their payments settle, the subscriptions those
 * invoices bill, and the bills their transfers and card payments pay.
 */
@Service
public class InvoicingWebhookHandler {

    private static final Logger log = LoggerFactory.getLogger(InvoicingWebhookHandler.class);
    private static final String TRANSFER_WEBHOOK = "balancePlatform.transfer.";

    private final InvoiceService invoiceService;
    private final SubscriptionService subscriptionService;
    private final BillService billService;
    private final ObjectMapper objectMapper;

    public InvoicingWebhookHandler(InvoiceService invoiceService, SubscriptionService subscriptionService,
                             BillService billService, ObjectMapper objectMapper) {
        this.invoiceService = invoiceService;
        this.subscriptionService = subscriptionService;
        this.billService = billService;
        this.objectMapper = objectMapper;
    }

    /** Never throws: Adyen must still get its [accepted]. */
    public void apply(String rawJson) {
        for (JsonNode item : AdyenNotifications.items(objectMapper, rawJson)) {
            Optional<Invoice> invoice;
            try {
                invoice = invoiceService.applyNotification(item);
            } catch (Exception e) {
                log.warn("Couldn't apply the {} webhook {} to the invoices: {}", AdyenNotifications.text(item, "eventCode"),
                        AdyenNotifications.text(item, "pspReference"), e.getMessage());
                continue;
            }
            invoice.map(Invoice::getSubscriptionId).ifPresent(subscriptionService::sync);
        }
        applyTransfer(rawJson);
    }

    private void applyTransfer(String rawJson) {
        if (rawJson == null || !rawJson.contains(TRANSFER_WEBHOOK)) {
            return;
        }
        JsonNode data = null;
        try {
            JsonNode root = objectMapper.readTree(rawJson);
            String type = AdyenNotifications.text(root, "type");
            if (type == null || !type.startsWith(TRANSFER_WEBHOOK)) {
                return;
            }
            data = root.path("data");
            billService.applyTransferWebhook(data);
        } catch (Exception e) {
            log.warn("Couldn't apply the transfer webhook {} to the bills: {}",
                    data != null ? AdyenNotifications.text(data, "id") : null, e.getMessage());
        }
    }
}
