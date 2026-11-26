package com.myplatform.demo.util;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The movements an automatic sweep moved out of its balance account. A sweep moves the balance that is available when
 * it runs, so each movement belongs to the first sweep after it became available: after both its booking date and its
 * value date (a captured payment is booked at once but only available once settled).
 */
public final class SweepBreakdown {

    /** Adyen names the transfers of a sweep {@code balance-sweep-<execution id>}. */
    public static final String SWEEP_REFERENCE_PREFIX = "balance-sweep-";

    private static final Set<String> FEE_PAYMENT_TYPES = Set.of("AcquiringFees", "AdyenCommission", "AdyenFees",
            "AdyenMarkup", "Commission", "DCCMarkup", "DCCPlatformCommission", "Interchange", "PaymentFee", "SchemeFee",
            "VAT");
    private static final Map<String, String> PROVIDER_FEE_LABELS = Map.of("AdyenCommission", "Processing commission",
            "AdyenFees", "Processing fees", "AdyenMarkup", "Processing markup");
    private static final Set<String> FEE_TYPES = Set.of("fee", "paymentCost", "miscCost", "cashoutFee");
    private static final Set<String> CHARGEBACK_TYPES = Set.of("chargeback", "chargebackCorrection", "chargebackReversal",
            "chargebackReversalCorrection", "secondChargeback", "secondChargebackCorrection");
    private static final Set<String> REFUND_TYPES = Set.of("refund", "refundReversal");

    private SweepBreakdown() {
    }

    /**
     * A transaction of the Transactions API: what a transfer booked on one balance account.
     *
     * @param amount signed: positive when it credits the balance account
     */
    public record Transaction(String id, String transferId, String transferReference, String status, long amount,
                              String currency, Instant createdAt, Instant bookedAt, Instant valueAt, String description) {

        /** When the amount could be swept: once both booked and available. */
        public Instant availableAt() {
            Instant at = bookedAt == null ? valueAt : valueAt == null || bookedAt.isAfter(valueAt) ? bookedAt : valueAt;
            return at != null ? at : createdAt != null ? createdAt : Instant.EPOCH;
        }

        public boolean isBooked() {
            return "booked".equals(status);
        }

        /** A sweep taking the balance out of the account. */
        public boolean isSweepOut() {
            return isBooked() && amount < 0 && transferReference != null
                    && transferReference.startsWith(SWEEP_REFERENCE_PREFIX);
        }
    }

    /** @param next the link to the next page, null on the last one */
    public record Page(List<Transaction> transactions, String next) {
    }

    /** @param previousSweep the sweep before, null when none was found in the transactions */
    public record Result(Transaction sweep, Transaction previousSweep, List<Transaction> included) {

        public long includedTotal() {
            return included.stream().mapToLong(Transaction::amount).sum();
        }
    }

    /** What a movement is, for people: a payment, its fees, a refund... */
    public record Description(String kind, String label, String reference, String pspReference) {
    }

    public static Page page(JsonNode root) {
        List<Transaction> transactions = new ArrayList<>();
        for (JsonNode node : root.path("data")) {
            String id = text(node, "id");
            if (id == null) {
                continue;
            }
            JsonNode amount = node.path("amount");
            transactions.add(new Transaction(id, text(node.path("transfer"), "id"),
                    text(node.path("transfer"), "reference"), text(node, "status"), amount.path("value").asLong(0),
                    text(amount, "currency"), instant(text(node, "creationDate")), instant(text(node, "bookingDate")),
                    instant(text(node, "valueDate")), text(node, "description")));
        }
        return new Page(transactions, text(root.path("_links").path("next"), "href"));
    }

    /**
     * The movements of the sweep, from the transactions of the balance account it took the money from.
     *
     * @param transferId the transfer of the sweep
     * @param reference  its reference, to find it when the transaction doesn't carry the same transfer id
     * @param amount     its amount, unsigned
     * @return null when the sweep isn't among the booked transactions
     */
    public static Result breakdown(String transferId, String reference, long amount, List<Transaction> transactions) {
        Transaction sweep = transactions.stream()
                .filter(t -> t.isBooked() && t.amount() < 0 && transferId.equals(t.transferId()))
                .findFirst()
                .orElseGet(() -> transactions.stream()
                        .filter(t -> t.isSweepOut() && Objects.equals(reference, t.transferReference())
                                && -t.amount() == amount)
                        .findFirst()
                        .orElse(null));
        if (sweep == null) {
            return null;
        }
        Instant until = sweep.availableAt();
        Comparator<Transaction> chronological = Comparator.comparing(Transaction::availableAt)
                .thenComparing(Transaction::id);
        Transaction previous = transactions.stream()
                .filter(t -> t.isSweepOut() && !t.id().equals(sweep.id())
                        && Objects.equals(t.currency(), sweep.currency())
                        && chronological.compare(t, sweep) < 0)
                .max(chronological)
                .orElse(null);
        Instant since = previous == null ? null : previous.availableAt();
        List<Transaction> included = transactions.stream()
                .filter(t -> t.isBooked() && !t.isSweepOut() && Objects.equals(t.currency(), sweep.currency())
                        && !t.availableAt().isAfter(until)
                        && (since == null || t.availableAt().isAfter(since)))
                .sorted(chronological)
                .toList();
        return new Result(sweep, previous, included);
    }

    /** @param transfer the transfer of the transaction, null when it couldn't be loaded */
    public static Description describe(Transaction transaction, AdyenTransfers.Movement transfer) {
        if (transfer == null) {
            return new Description("OTHER", transaction.description() != null ? transaction.description() : "Movement",
                    transaction.transferReference(), null);
        }
        String category = Objects.toString(transfer.category(), "");
        String type = Objects.toString(transfer.type(), "");
        String paymentType = transfer.platformPaymentType();
        String reference = firstNonNull(transfer.paymentMerchantReference(), transfer.modificationMerchantReference(),
                transfer.reference());
        String pspReference = transfer.pspPaymentReference();
        if (FEE_TYPES.contains(type)) {
            return new Description("FEE", "Fees", reference, pspReference);
        }
        return switch (category) {
            case "platformPayment" -> {
                if (paymentType != null && FEE_PAYMENT_TYPES.contains(paymentType)) {
                    yield new Description("FEE", PROVIDER_FEE_LABELS.getOrDefault(paymentType, words(paymentType)),
                            reference, pspReference);
                }
                if (CHARGEBACK_TYPES.contains(type) || "ChargebackRemainder".equals(paymentType)) {
                    yield new Description("CHARGEBACK", words(CHARGEBACK_TYPES.contains(type) ? type : "chargeback"),
                            reference, pspReference);
                }
                if (REFUND_TYPES.contains(type)) {
                    yield new Description("REFUND", words(type), reference, pspReference);
                }
                yield new Description("PAYMENT", "Tip".equals(paymentType) || "Surcharge".equals(paymentType)
                        ? paymentType : "Payment", reference, pspReference);
            }
            case "internal" -> new Description("TRANSFER", transaction.amount() > 0
                    ? "Transfer from another account" : "Transfer to another account", transfer.reference(), null);
            case "bank" -> new Description("TRANSFER", transaction.amount() > 0 ? "Incoming bank transfer" : "Bank transfer",
                    transfer.reference(), null);
            case "topUp" -> new Description("TRANSFER", "Top-up", transfer.reference(), null);
            case "issuedCard" -> new Description("OTHER", "Card payment", transfer.counterpartyName(), null);
            default -> new Description("OTHER", category.isEmpty() ? "Movement" : words(category), transfer.reference(),
                    pspReference);
        };
    }

    /** "SchemeFee" and "refundReversal" as "Scheme fee" and "Refund reversal". */
    static String words(String camelCase) {
        String spaced = camelCase.replaceAll("(?<=[a-z0-9])(?=[A-Z])", " ").toLowerCase();
        return spaced.isEmpty() ? spaced : Character.toUpperCase(spaced.charAt(0)) + spaced.substring(1);
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
