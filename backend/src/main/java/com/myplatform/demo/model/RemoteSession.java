package com.myplatform.demo.model;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Something started on a computer and finished on a phone that opened its QR code link: the
 * registration of the phone as trusted device (pairing) or the approval of an operation that
 * needs strong customer authentication. Kept in memory for a few minutes only.
 */
public class RemoteSession {

    public enum Type {
        PAIRING("pairing"),
        TRANSFER("transfer"),
        STANDING_ORDER("standingOrder"),
        BATCH("batch"),
        TRANSACTIONS("transactions");

        private final String value;

        Type(String value) {
            this.value = value;
        }

        public String value() {
            return value;
        }

        public static Optional<Type> fromValue(String value) {
            return Arrays.stream(values()).filter(type -> type.value.equals(value)).findFirst();
        }
    }

    public enum Status {
        /** The QR code is shown on the computer. */
        WAITING,
        /** The phone opened the link. */
        OPENED,
        /** The phone is creating or using its passkey. */
        IN_PROGRESS,
        COMPLETED,
        /** Refused on the phone. */
        DECLINED,
        /** Closed on the computer, or replaced by a newer session. */
        CANCELLED,
        EXPIRED;

        public String value() {
            return name().toLowerCase(Locale.ROOT);
        }

        public boolean isFinal() {
            return this == COMPLETED || this == DECLINED || this == CANCELLED || this == EXPIRED;
        }
    }

    /** What the phone registers or approves; the Adyen identifiers are resolved when the session is created. */
    public sealed interface Operation permits Pairing, TransferApproval, StandingOrderApproval, BatchApproval, TransactionsApproval {
    }

    /** @param virtualPi null when the balance account has no virtual bank account to associate the device with */
    public record Pairing(String deviceName, String physicalPi, String virtualPi) implements Operation {
    }

    public record TransferApproval(TransferRequest request, String paymentInstrumentId,
                                   RecipientCountry recipientCountry) implements Operation {
    }

    public record StandingOrderApproval(Map<String, Object> standingOrder, String balanceAccountId) implements Operation {
    }

    public record BatchApproval(List<String> transferIds) implements Operation {
    }

    public record TransactionsApproval(String accountHolderId, String balanceAccountId) implements Operation {
    }

    private final String id;
    private final String tokenHash;
    private final Type type;
    private final String userId;
    private final Operation operation;
    /** Shown on the phone; built from the operation, never from what the computer displays. */
    private final Map<String, Object> summary;
    private final Instant createdAt;
    private final Duration window;

    private Instant expiresAt;
    private Instant updatedAt;
    private Status status = Status.WAITING;
    /** A step is running on Adyen: a second one (double tap, second tab) must not send the operation twice. */
    private boolean busy;
    private String phoneLabel;
    private Boolean phonePasskeys;
    private String message;
    /** Pairing: the Adyen id of the device being registered, then whether its registration is complete. */
    private String deviceId;
    private boolean deviceRegistered;
    /** Transactions approval: the period the SCA challenge was issued for. */
    private String createdSince;
    private String createdUntil;
    /** Approval: what the computer reads once the session is completed. */
    private Object result;

    public RemoteSession(String id, String tokenHash, Type type, String userId, Operation operation,
                         Map<String, Object> summary, Instant now, Duration window) {
        this.id = id;
        this.tokenHash = tokenHash;
        this.type = type;
        this.userId = userId;
        this.operation = operation;
        this.summary = summary;
        this.createdAt = now;
        this.updatedAt = now;
        this.window = window;
        this.expiresAt = now.plus(window);
    }

    /** Expires the session once its window has passed without being completed. */
    public synchronized Status refresh(Instant now) {
        if (!status.isFinal() && now.isAfter(expiresAt)) {
            status = Status.EXPIRED;
            updatedAt = now;
        }
        return status;
    }

    /** The phone opened the link: the user gets a full window from now to finish on the phone. */
    public synchronized void open(Instant now, String phoneLabel, Boolean phonePasskeys) {
        if (refresh(now).isFinal()) return;
        if (status == Status.WAITING) {
            status = Status.OPENED;
        }
        this.phoneLabel = phoneLabel;
        this.phonePasskeys = phonePasskeys;
        this.message = null;
        extend(now);
    }

    /** Starts a step on the phone; false when the session can no longer be used or a step is already running. */
    public synchronized boolean begin(Instant now) {
        if (refresh(now).isFinal() || status == Status.WAITING || busy) return false;
        status = Status.IN_PROGRESS;
        busy = true;
        message = null;
        extend(now);
        return true;
    }

    public synchronized void release() {
        busy = false;
    }

    public synchronized boolean isBusy() {
        return busy;
    }

    public synchronized void complete(Instant now, Object result) {
        status = Status.COMPLETED;
        this.result = result;
        this.message = null;
        updatedAt = now;
    }

    /** Ends the session unless it already ended; returns its final status. */
    public synchronized Status end(Instant now, Status finalStatus) {
        if (!refresh(now).isFinal()) {
            status = finalStatus;
            updatedAt = now;
        }
        return status;
    }

    /** A problem on the phone the user can retry; shown on the computer meanwhile. */
    public synchronized void fail(Instant now, String message) {
        this.message = message;
        updatedAt = now;
    }

    public synchronized long secondsLeft(Instant now) {
        return Math.max(0, Duration.between(now, expiresAt).getSeconds());
    }

    private void extend(Instant now) {
        Instant extended = now.plus(window);
        if (extended.isAfter(expiresAt)) {
            expiresAt = extended;
        }
        updatedAt = now;
    }

    public String getId() { return id; }
    public String getTokenHash() { return tokenHash; }
    public Type getType() { return type; }
    public String getUserId() { return userId; }
    public Operation getOperation() { return operation; }
    public Map<String, Object> getSummary() { return summary; }
    public Instant getCreatedAt() { return createdAt; }
    public synchronized Instant getUpdatedAt() { return updatedAt; }
    public synchronized Status getStatus() { return status; }
    public synchronized String getPhoneLabel() { return phoneLabel; }
    public synchronized Boolean getPhonePasskeys() { return phonePasskeys; }
    public synchronized String getMessage() { return message; }
    public synchronized String getDeviceId() { return deviceId; }
    public synchronized void setDeviceId(String deviceId) { this.deviceId = deviceId; }
    public synchronized boolean isDeviceRegistered() { return deviceRegistered; }
    public synchronized void setDeviceRegistered(boolean deviceRegistered) { this.deviceRegistered = deviceRegistered; }
    public synchronized String getCreatedSince() { return createdSince; }
    public synchronized String getCreatedUntil() { return createdUntil; }
    public synchronized void setChallengePeriod(String createdSince, String createdUntil) {
        this.createdSince = createdSince;
        this.createdUntil = createdUntil;
    }
    public synchronized Object getResult() { return result; }
}
