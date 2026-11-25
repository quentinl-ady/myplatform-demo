package com.myplatform.demo.model;

import java.util.List;
import java.util.Map;

public final class TopUpModels {
    private TopUpModels() {}

    /** A capability can be used only when it is both allowed (verified) and enabled. */
    public record Capability(Boolean requested, Boolean allowed, Boolean enabled, String verificationStatus) {}
    /** status: verified, pending, actionRequired or unknown when the verification could not be read. */
    public record BankAccount(String transferInstrumentId, String accountNumber, String bankName,
                              String countryCode, String status) {}
    /** minimumBalance is null when the collection happens regardless of the balance. */
    public record Sweep(String id, String status, String schedule, Long amount, String currency,
                        String transferInstrumentId, Long minimumBalance) {}
    public record Context(boolean businessAccountExists, String balanceAccountId, String currency,
                          String paymentMethod, String mandateKind, Map<String, Capability> capabilities, List<Sweep> sweeps, List<String> messages) {}
    public record Payment(Long amount, String transferInstrumentId, Boolean mandateAccepted) {}
    public record Result(String pspReference, String resultCode, String refusalReason, Long amount, String currency) {}
    public record SweepRequest(String transferInstrumentId, Long amount, String schedule) {}
    public record SweepStatus(Boolean active) {}
}
