package com.myplatform.demo.util;

import com.adyen.model.balanceplatform.CreateSweepConfigurationV2;
import com.adyen.model.balanceplatform.SweepCounterparty;
import com.adyen.model.balanceplatform.SweepSchedule;
import com.adyen.model.checkout.*;
import com.adyen.model.legalentitymanagement.BankAccountInfo;
import com.adyen.model.legalentitymanagement.IbanAccountIdentification;
import com.adyen.model.legalentitymanagement.SupportingEntityCapability;
import com.adyen.model.legalentitymanagement.UKLocalAccountIdentification;
import com.adyen.model.legalentitymanagement.USLocalAccountIdentification;
import com.myplatform.demo.exception.BadRequestException;

import java.util.Collection;
import java.util.List;
import java.util.Set;

public final class TopUpRequests {
    /**
     * A pull sweep only collects when the balance is at or below its trigger amount. A trigger far above any
     * demo balance makes the weekly or monthly collection unconditional.
     */
    public static final long ALWAYS_TRIGGER = 1_000_000_000L;
    private static final Set<String> SCHEDULES = Set.of("weekly", "monthly");

    private TopUpRequests() {}

    public static String paymentMethod(String currency) {
        if (currency == null) return null;
        return switch (currency) {
            case "EUR" -> "sepadirectdebit";
            case "USD" -> "ach";
            case "GBP" -> "directdebit_GB";
            default -> null;
        };
    }

    public static String mandateKind(String currency) {
        if (currency == null) return "none";
        return switch (currency) {
            case "EUR" -> "SEPA";
            case "USD" -> "ACH";
            case "GBP" -> "BACS";
            default -> "none";
        };
    }

    public static void validate(Long amount, String instrument, Boolean mandateAccepted, String currency) {
        positive(amount, "Amount");
        if (instrument == null || instrument.isBlank()) throw new BadRequestException("Select a bank account.");
        if (!Boolean.TRUE.equals(mandateAccepted)) throw new BadRequestException("Accept the direct debit authorization.");
        if (paymentMethod(currency) == null) throw new BadRequestException("Direct debit top-ups are not supported for this currency.");
    }

    public static void positive(Long value, String field) {
        if (value == null || value <= 0) throw new BadRequestException(field + " must be greater than zero.");
    }

    public static CheckoutPaymentMethod details(String currency, String instrument) {
        if (paymentMethod(currency) == null) throw new BadRequestException("Unsupported direct debit currency.");
        return switch (currency) {
            case "EUR" -> new CheckoutPaymentMethod(new SepaDirectDebitDetails()
                    .type(SepaDirectDebitDetails.TypeEnum.SEPADIRECTDEBIT).transferInstrumentId(instrument));
            case "USD" -> new CheckoutPaymentMethod(new AchDetails()
                    .type(AchDetails.TypeEnum.ACH).transferInstrumentId(instrument));
            default -> new CheckoutPaymentMethod(new BacsDirectDebitDetails()
                    .type(BacsDirectDebitDetails.TypeEnum.DIRECTDEBIT_GB).transferInstrumentId(instrument));
        };
    }

    public static List<Split> splits(long amount, String currency, String reference, String balanceAccountId) {
        return List.of(new Split().type(Split.TypeEnum.TOPUP).account(balanceAccountId)
                        .amount(new SplitAmount().currency(currency).value(amount)).reference(reference)
                        .description("Business account top-up"),
                // Omitting the account books only the fees to the platform's liable account.
                new Split().type(Split.TypeEnum.PAYMENTFEE).reference("FEES-" + reference)
                        .description("Top-up payment fees"));
    }

    public static CreateSweepConfigurationV2 sweep(String merchant, String instrument, String currency,
                                                    Long amount, String schedule) {
        validate(amount, instrument, true, currency);
        if (schedule == null || !SCHEDULES.contains(schedule)) {
            throw new BadRequestException("Choose a weekly or monthly top-up.");
        }
        return new CreateSweepConfigurationV2().type(CreateSweepConfigurationV2.TypeEnum.PULL)
                .currency(currency)
                .counterparty(new SweepCounterparty().merchantAccount(merchant).transferInstrumentId(instrument))
                .triggerAmount(new com.adyen.model.balanceplatform.Amount().currency(currency).value(ALWAYS_TRIGGER))
                .sweepAmount(new com.adyen.model.balanceplatform.Amount().currency(currency).value(amount))
                .schedule(new SweepSchedule().type(SweepSchedule.TypeEnum.fromValue(schedule)))
                .description("weekly".equals(schedule) ? "Weekly top-up" : "Monthly top-up");
    }

    /** The trigger of a sweep that only collects below a balance, or null for an unconditional collection. */
    public static Long minimumBalance(Long trigger) {
        return trigger == null || trigger >= ALWAYS_TRIGGER ? null : trigger;
    }

    /** Readable account number of a verified bank account, or null when its format is not displayed. */
    public static String accountNumber(BankAccountInfo bank) {
        if (bank == null || bank.getAccountIdentification() == null) return null;
        Object id = bank.getAccountIdentification().getActualInstance();
        if (id instanceof IbanAccountIdentification iban) return groups(iban.getIban());
        if (id instanceof UKLocalAccountIdentification uk) {
            return joined(sortCode(uk.getSortCode()), uk.getAccountNumber());
        }
        if (id instanceof USLocalAccountIdentification us) return joined(us.getRoutingNumber(), us.getAccountNumber());
        return null;
    }

    /** Verification of a bank account, from the capabilities its legal entity uses it for. */
    public static String bankStatus(Collection<SupportingEntityCapability> capabilities) {
        if (capabilities == null || capabilities.isEmpty()) return "unknown";
        boolean pending = false;
        for (SupportingEntityCapability capability : capabilities) {
            String status = capability.getVerificationStatus();
            if (Boolean.TRUE.equals(capability.getAllowed()) || "valid".equals(status)) return "verified";
            if ("invalid".equals(status) || "rejected".equals(status)) return "actionRequired";
            pending |= "pending".equals(status);
        }
        return pending ? "pending" : "unknown";
    }

    public static String masked(String identifier) {
        if (identifier == null || identifier.isBlank()) return "Bank account";
        String compact = identifier.replaceAll("\\s", "");
        return "•••• " + compact.substring(Math.max(0, compact.length() - 4));
    }

    private static String groups(String iban) {
        if (iban == null || iban.isBlank()) return null;
        return iban.replaceAll("\\s", "").toUpperCase().replaceAll("(.{4})(?!$)", "$1 ");
    }

    private static String sortCode(String code) {
        if (code == null) return null;
        String digits = code.replaceAll("\\D", "");
        return digits.length() == 6 ? digits.replaceAll("(\\d{2})(\\d{2})(\\d{2})", "$1-$2-$3") : code;
    }

    private static String joined(String bankCode, String account) {
        if (account == null || account.isBlank()) return null;
        return bankCode == null || bankCode.isBlank() ? account : bankCode + " · " + account;
    }
}
