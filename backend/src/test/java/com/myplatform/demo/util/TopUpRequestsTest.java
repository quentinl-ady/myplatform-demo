package com.myplatform.demo.util;

import com.adyen.model.balanceplatform.CreateSweepConfigurationV2;
import com.adyen.model.balanceplatform.SweepSchedule;
import com.adyen.model.checkout.Split;
import com.adyen.model.legalentitymanagement.*;
import com.myplatform.demo.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TopUpRequestsTest {
    @Test
    void choosesDirectDebitMethodAndMandate() {
        assertEquals("sepadirectdebit", TopUpRequests.paymentMethod("EUR"));
        assertEquals("ach", TopUpRequests.paymentMethod("USD"));
        assertEquals("directdebit_GB", TopUpRequests.paymentMethod("GBP"));
        assertEquals("SEPA", TopUpRequests.mandateKind("EUR"));
        assertEquals("ACH", TopUpRequests.mandateKind("USD"));
        assertEquals("BACS", TopUpRequests.mandateKind("GBP"));
        for (String currency : List.of("CAD", "AUD", "")) {
            assertNull(TopUpRequests.paymentMethod(currency));
            assertEquals("none", TopUpRequests.mandateKind(currency));
        }
        assertNull(TopUpRequests.paymentMethod(null));
        assertEquals("ti-1", TopUpRequests.details("EUR", "ti-1").getSepaDirectDebitDetails().getTransferInstrumentId());
        assertEquals("ti-2", TopUpRequests.details("USD", "ti-2").getAchDetails().getTransferInstrumentId());
        assertEquals("ti-3", TopUpRequests.details("GBP", "ti-3").getBacsDirectDebitDetails().getTransferInstrumentId());
    }

    @Test
    void assignsFullTopUpAndOnlyFeesToLiableAccount() {
        var splits = TopUpRequests.splits(12345, "EUR", "TOPUP-1", "BA-business");
        assertEquals(2, splits.size());
        assertEquals(Split.TypeEnum.TOPUP, splits.get(0).getType());
        assertEquals("BA-business", splits.get(0).getAccount());
        assertEquals(12345L, splits.get(0).getAmount().getValue());
        assertEquals("EUR", splits.get(0).getAmount().getCurrency());
        assertEquals("TOPUP-1", splits.get(0).getReference());
        assertEquals(Split.TypeEnum.PAYMENTFEE, splits.get(1).getType());
        assertNull(splits.get(1).getAccount());
        assertNull(splits.get(1).getAmount());
        assertNotNull(splits.get(1).getReference());
    }

    @Test
    void buildsUnconditionalWeeklyAndMonthlyPullSweeps() {
        for (String schedule : List.of("weekly", "monthly")) {
            var sweep = TopUpRequests.sweep("merchant", "ti-1", "EUR", 10000L, schedule);
            assertEquals(CreateSweepConfigurationV2.TypeEnum.PULL, sweep.getType());
            assertEquals("merchant", sweep.getCounterparty().getMerchantAccount());
            assertEquals("ti-1", sweep.getCounterparty().getTransferInstrumentId());
            assertNull(sweep.getCounterparty().getBalanceAccountId());
            assertEquals("EUR", sweep.getCurrency());
            assertEquals(TopUpRequests.ALWAYS_TRIGGER, sweep.getTriggerAmount().getValue());
            assertEquals("EUR", sweep.getTriggerAmount().getCurrency());
            assertEquals(10000L, sweep.getSweepAmount().getValue());
            assertNull(sweep.getTargetAmount());
            assertEquals(SweepSchedule.TypeEnum.fromValue(schedule), sweep.getSchedule().getType());
        }
        assertEquals("Weekly top-up", TopUpRequests.sweep("m", "ti", "USD", 1L, "weekly").getDescription());
        assertEquals("Monthly top-up", TopUpRequests.sweep("m", "ti", "GBP", 1L, "monthly").getDescription());
        assertNull(TopUpRequests.minimumBalance(TopUpRequests.ALWAYS_TRIGGER));
        assertNull(TopUpRequests.minimumBalance(null));
        assertEquals(50000L, TopUpRequests.minimumBalance(50000L));
    }

    @Test
    void rejectsInvalidPaymentAndSweepInputs() {
        assertDoesNotThrow(() -> TopUpRequests.validate(1L, "ti", true, "EUR"));
        for (Long amount : new Long[]{null, 0L, -1L}) {
            assertThrows(BadRequestException.class, () -> TopUpRequests.validate(amount, "ti", true, "EUR"));
        }
        assertThrows(BadRequestException.class, () -> TopUpRequests.validate(1L, null, true, "EUR"));
        assertThrows(BadRequestException.class, () -> TopUpRequests.validate(1L, " ", true, "EUR"));
        assertThrows(BadRequestException.class, () -> TopUpRequests.validate(1L, "ti", false, "EUR"));
        assertThrows(BadRequestException.class, () -> TopUpRequests.validate(1L, "ti", null, "EUR"));
        assertThrows(BadRequestException.class, () -> TopUpRequests.validate(1L, "ti", true, "CAD"));
        assertThrows(BadRequestException.class, () -> TopUpRequests.sweep("m", "ti", "EUR", 0L, "weekly"));
        assertThrows(BadRequestException.class, () -> TopUpRequests.sweep("m", "ti", "CAD", 1L, "weekly"));
        for (String schedule : new String[]{"daily", "balance", "cron", null}) {
            assertThrows(BadRequestException.class, () -> TopUpRequests.sweep("m", "ti", "EUR", 1L, schedule));
        }
    }

    @Test
    void showsFullBankAccountNumbers() {
        assertEquals("FR76 3000 6000 0112 3456 7890 189", TopUpRequests.accountNumber(bank(new BankAccountInfoAccountIdentification(
                new IbanAccountIdentification().iban("fr7630006000011234567890189").type(IbanAccountIdentification.TypeEnum.IBAN)))));
        assertEquals("NL91 ABNA 0417 1643 00", TopUpRequests.accountNumber(bank(new BankAccountInfoAccountIdentification(
                new IbanAccountIdentification().iban("NL91 ABNA 0417 1643 00").type(IbanAccountIdentification.TypeEnum.IBAN)))));
        assertEquals("40-47-84 · 12345678", TopUpRequests.accountNumber(bank(new BankAccountInfoAccountIdentification(
                new UKLocalAccountIdentification().sortCode("404784").accountNumber("12345678")
                        .type(UKLocalAccountIdentification.TypeEnum.UKLOCAL)))));
        assertEquals("011000138 · 123456789", TopUpRequests.accountNumber(bank(new BankAccountInfoAccountIdentification(
                new USLocalAccountIdentification().routingNumber("011000138").accountNumber("123456789")
                        .type(USLocalAccountIdentification.TypeEnum.USLOCAL)))));
        assertNull(TopUpRequests.accountNumber(null));
        assertNull(TopUpRequests.accountNumber(new BankAccountInfo()));
    }

    @Test
    void readsBankAccountVerification() {
        assertEquals("unknown", TopUpRequests.bankStatus(null));
        assertEquals("unknown", TopUpRequests.bankStatus(List.of()));
        assertEquals("verified", TopUpRequests.bankStatus(List.of(new SupportingEntityCapability(true, null, true, "pending"))));
        assertEquals("verified", TopUpRequests.bankStatus(List.of(capability("pending"), capability("valid"))));
        assertEquals("pending", TopUpRequests.bankStatus(List.of(capability("pending"))));
        assertEquals("actionRequired", TopUpRequests.bankStatus(List.of(capability("invalid"))));
        assertEquals("actionRequired", TopUpRequests.bankStatus(List.of(capability("rejected"))));
    }

    @Test
    void masksBankIdentifiers() {
        assertEquals("•••• 1234", TopUpRequests.masked("FR76 1234"));
        assertEquals("Bank account", TopUpRequests.masked(null));
        assertEquals("•••• 12", TopUpRequests.masked("12"));
    }

    private static SupportingEntityCapability capability(String status) {
        return new SupportingEntityCapability(false, null, true, status);
    }

    private static BankAccountInfo bank(BankAccountInfoAccountIdentification identification) {
        return new BankAccountInfo().accountIdentification(identification);
    }
}
