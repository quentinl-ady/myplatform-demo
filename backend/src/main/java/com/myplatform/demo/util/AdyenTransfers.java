package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reads the transfers the Transfers API lists (GET /transfers) as movements of balance accounts. A transfer books its
 * amount when its accounting events move it to the balance register; until then the money is only received or reserved.
 */
public final class AdyenTransfers {

    /** Without accounting events, these statuses tell that the transfer is booked. */
    private static final Set<String> BOOKED_STATUSES = Set.of("booked", "captured", "credited");

    private AdyenTransfers() {
    }

    /**
     * @param amount           the amount of the transfer, signed by its direction: positive when it credits the balance
     *                         account
     * @param booked           what the transfer booked on the balance account, signed the same way: 0 when nothing is
     *                         booked yet
     * @param currency         the currency of what is booked, else of the transfer
     * @param bookedAt         when the balance account was last booked, null when it wasn't
     * @param counterpartyName the holder of the counterparty bank account, or the merchant of a card payment
     * @param paymentInstrumentId the card of a card payment
     */
    public record Movement(String id,
                           String balanceAccountId,
                           String category,
                           String type,
                           String platformPaymentType,
                           String status,
                           String currency,
                           long amount,
                           long booked,
                           Instant bookedAt,
                           Instant createdAt,
                           String reference,
                           String description,
                           String referenceForBeneficiary,
                           String pspPaymentReference,
                           String paymentMerchantReference,
                           String modificationMerchantReference,
                           String counterpartyBalanceAccountId,
                           String counterpartyTransferInstrumentId,
                           String counterpartyName,
                           String paymentInstrumentId,
                           int sequenceNumber) {

        public boolean isBooked() {
            return booked != 0;
        }

        /** The day the movement was booked, in UTC. */
        public LocalDate bookingDate() {
            return bookedAt.atZone(ZoneOffset.UTC).toLocalDate();
        }

        /** Identifies the movement of a transfer on one balance account: an internal transfer moves two of them. */
        public String key() {
            return id + "|" + balanceAccountId;
        }
    }

    /** @param next the link to the next page, null on the last one */
    public record Page(List<Movement> movements, String next) {
    }

    public static Page page(JsonNode root) {
        List<Movement> movements = new ArrayList<>();
        for (JsonNode node : root.path("data")) {
            Movement movement = movement(node);
            if (movement != null) {
                movements.add(movement);
            }
        }
        return new Page(movements, text(root.path("_links").path("next"), "href"));
    }

    /** The movement of a transfer, null when the transfer has no id or no balance account. */
    public static Movement movement(JsonNode node) {
        String id = text(node, "id");
        String balanceAccountId = text(node.path("balanceAccount"), "id");
        if (id == null || balanceAccountId == null) {
            return null;
        }
        String direction = text(node, "direction");
        String status = text(node, "status");
        JsonNode amountNode = node.path("amount");
        long value = amountNode.path("value").asLong(0);
        long amount = "outgoing".equals(direction) ? -Math.abs(value) : "incoming".equals(direction) ? Math.abs(value) : value;
        String currency = text(amountNode, "currency");
        Instant createdAt = instant(firstNonNull(text(node, "createdAt"), text(node, "creationDate")));

        long booked = 0;
        String bookedCurrency = null;
        Instant bookedAt = null;
        boolean hasMutations = false;
        for (JsonNode event : node.path("events")) {
            JsonNode mutations = event.path("mutations");
            if (!mutations.isArray() || mutations.isEmpty()) {
                continue;
            }
            hasMutations = true;
            for (JsonNode mutation : mutations) {
                long balance = mutation.path("balance").asLong(0);
                String mutationCurrency = text(mutation, "currency");
                if (balance == 0 || (bookedCurrency != null && mutationCurrency != null && !bookedCurrency.equals(mutationCurrency))) {
                    continue;
                }
                if (bookedCurrency == null) {
                    bookedCurrency = mutationCurrency;
                }
                booked += balance;
                Instant at = instant(firstNonNull(text(event, "bookingDate"), text(event, "valueDate"), text(event, "updateDate")));
                if (at != null && (bookedAt == null || at.isAfter(bookedAt))) {
                    bookedAt = at;
                }
            }
        }
        if (!hasMutations && status != null && BOOKED_STATUSES.contains(status)) {
            booked = amount;
            bookedAt = instant(text(node, "updatedAt"));
        }
        if (booked == 0) {
            bookedAt = null;
        } else if (bookedAt == null) {
            bookedAt = createdAt != null ? createdAt : Instant.now();
        }

        JsonNode categoryData = node.path("categoryData");
        JsonNode counterparty = node.path("counterparty");
        JsonNode merchant = counterparty.path("merchant");
        String counterpartyName = firstNonNull(
                text(counterparty.path("bankAccount").path("accountHolder"), "fullName"),
                text(merchant, "name"),
                text(merchant.path("nameLocation"), "name"));
        return new Movement(id, balanceAccountId, text(node, "category"), text(node, "type"),
                text(categoryData, "platformPaymentType"), status,
                booked != 0 && bookedCurrency != null ? bookedCurrency : currency,
                amount, booked, bookedAt, createdAt,
                text(node, "reference"), text(node, "description"), text(node, "referenceForBeneficiary"),
                text(categoryData, "pspPaymentReference"), text(categoryData, "paymentMerchantReference"),
                text(categoryData, "modificationMerchantReference"),
                text(counterparty, "balanceAccountId"), text(counterparty, "transferInstrumentId"), counterpartyName,
                text(node.path("paymentInstrument"), "id"), node.path("sequenceNumber").asInt(0));
    }

    /** The latest version of each movement: a list can return a transfer once per update, with a higher sequence number. */
    public static List<Movement> latest(List<Movement> movements) {
        Map<String, Movement> latest = new LinkedHashMap<>();
        for (Movement movement : movements) {
            latest.merge(movement.key(), movement,
                    (kept, other) -> other.sequenceNumber() >= kept.sequenceNumber() ? other : kept);
        }
        return new ArrayList<>(latest.values());
    }

    private static Instant instant(String value) {
        if (value == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull() || value.isContainerNode()) {
            return null;
        }
        String text = value.asText();
        return text.isBlank() ? null : text;
    }

    private static String firstNonNull(String... values) {
        for (String value : values) {
            if (value != null) {
                return value;
            }
        }
        return null;
    }
}
