package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.checkout.PaymentRequest;
import com.adyen.service.balanceplatform.AccountHoldersApi;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.checkout.PaymentsApi;
import com.adyen.service.legalentitymanagement.TransferInstrumentsApi;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.TopUpModels.*;
import com.myplatform.demo.model.TopUpModels.BankAccount;
import com.myplatform.demo.model.User;
import com.myplatform.demo.util.TopUpRequests;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;

@Service
public class TopUpService {
    private final PaymentsApi payments;
    private final BalanceAccountsApi balanceAccounts;
    private final AccountHoldersApi accountHolders;
    private final TransferInstrumentsApi transferInstruments;
    private final BankAccountResolver bankAccounts;
    private final LegalEntityService legalEntities;
    private final String merchantAccount;
    private final String frontendUrl;
    private static final String TRANSFER_INSTRUMENT = "receiveFromTransferInstrument";
    private static final List<String> CAPABILITIES = List.of(TRANSFER_INSTRUMENT, "receiveFromPlatformPayments");

    public TopUpService(@Qualifier("pspClient") Client pspClient,
                        @Qualifier("balancePlatformClient") Client balanceClient,
                        @Qualifier("lemClient") Client lemClient,
                        BankAccountResolver bankAccounts,
                        LegalEntityService legalEntities, @Value("${adyen.merchantAccount}") String merchantAccount,
                        @Value("${app.frontend.url}") String frontendUrl) {
        this.payments = new PaymentsApi(pspClient);
        this.balanceAccounts = new BalanceAccountsApi(balanceClient);
        this.accountHolders = new AccountHoldersApi(balanceClient);
        this.transferInstruments = new TransferInstrumentsApi(lemClient);
        this.bankAccounts = bankAccounts;
        this.legalEntities = legalEntities;
        this.merchantAccount = merchantAccount;
        this.frontendUrl = frontendUrl;
    }

    public Context context(User user) {
        List<String> messages = new ArrayList<>();
        String balanceAccountId = null;
        String currency = user.getCurrencyCode();
        if (bankAccounts.hasBankAccount(user)) {
            try {
                BalanceAccount account = businessAccount(user);
                balanceAccountId = account.getId();
                currency = account.getDefaultCurrencyCode();
            } catch (Exception e) {
                messages.add("The business account details could not be loaded. Try again.");
            }
        }
        Map<String, Capability> capabilities = new LinkedHashMap<>();
        try {
            capabilities = capabilityStatus(user);
        } catch (Exception e) {
            messages.add("The direct debit permissions could not be loaded. Try again.");
        }
        List<Sweep> sweeps = new ArrayList<>();
        if (balanceAccountId != null) {
            try {
                for (SweepConfigurationV2 sweep : allSweeps(balanceAccountId)) {
                    if (isPull(sweep)) sweeps.add(toSweep(sweep));
                }
            } catch (Exception e) {
                messages.add("Automatic top-ups could not be loaded. Try again.");
            }
        }
        return new Context(bankAccounts.hasBankAccount(user), balanceAccountId, currency,
                TopUpRequests.paymentMethod(currency), TopUpRequests.mandateKind(currency), capabilities, sweeps, messages);
    }

    /** The bank accounts verified during onboarding, which can be debited. */
    public List<BankAccount> bankAccounts(User user) throws Exception {
        requireAccountHolder(user);
        List<BankAccount> result = new ArrayList<>();
        for (var account : legalEntities.getPayoutAccounts(user.getLegalEntityId())) {
            result.add(bankAccount(account.getTransferInstrumentId(), account.getAccountIdentifier()));
        }
        return result;
    }

    /** Requests receiveFromTransferInstrument, then enables it: Adyen rejects both settings in a single request. */
    public Map<String, Capability> requestCapability(User user) throws Exception {
        requireAccountHolder(user);
        String id = user.getAccountHolderId();
        var capability = capability(accountHolders.getAccountHolder(id), TRANSFER_INSTRUMENT);
        if (capability == null || !Boolean.TRUE.equals(capability.getRequested())) {
            capability = capability(accountHolders.updateAccountHolder(id, new AccountHolderUpdateRequest()
                    .putCapabilitiesItem(TRANSFER_INSTRUMENT, new AccountHolderCapability().requested(true))), TRANSFER_INSTRUMENT);
        }
        if (capability == null || !Boolean.TRUE.equals(capability.getEnabled())) {
            accountHolders.updateAccountHolder(id, new AccountHolderUpdateRequest()
                    .putCapabilitiesItem(TRANSFER_INSTRUMENT, new AccountHolderCapability().enabled(true)));
        }
        return capabilityStatus(user);
    }

    public Result topUp(User user, Payment request) throws Exception {
        BalanceAccount account = businessAccount(user);
        String currency = account.getDefaultCurrencyCode();
        TopUpRequests.validate(request.amount(), request.transferInstrumentId(), request.mandateAccepted(), currency);
        requireCapabilities(user);
        requireInstrument(user, request.transferInstrumentId());
        String reference = "TOPUP-" + UUID.randomUUID();
        String returnUrl = UriComponentsBuilder.fromUriString(frontendUrl).pathSegment(user.getId(), "fund-account")
                .build().encode().toUriString();
        var response = payments.payments(new PaymentRequest().merchantAccount(merchantAccount)
                .amount(new com.adyen.model.checkout.Amount().currency(currency).value(request.amount()))
                .reference(reference).returnUrl(returnUrl)
                .paymentMethod(TopUpRequests.details(currency, request.transferInstrumentId()))
                .splits(TopUpRequests.splits(request.amount(), currency, reference, account.getId())));
        return new Result(response.getPspReference(), response.getResultCode() == null ? null : response.getResultCode().getValue(),
                response.getRefusalReason(), request.amount(), currency);
    }

    public Sweep createSweep(User user, SweepRequest request) throws Exception {
        BalanceAccount account = businessAccount(user);
        var configuration = TopUpRequests.sweep(merchantAccount, request.transferInstrumentId(),
                account.getDefaultCurrencyCode(), request.amount(), request.schedule());
        requireCapabilities(user);
        requireInstrument(user, request.transferInstrumentId());
        return toSweep(balanceAccounts.createSweep(account.getId(), configuration));
    }

    public Sweep updateSweep(User user, String sweepId, Boolean active) throws Exception {
        if (active == null) throw new BadRequestException("Specify whether the automatic top-up is active.");
        BalanceAccount account = businessAccount(user);
        SweepConfigurationV2 sweep = ownedSweep(account.getId(), sweepId);
        if (active) {
            requireCapabilities(user);
            requireInstrument(user, sweep.getCounterparty().getTransferInstrumentId());
        }
        return toSweep(balanceAccounts.updateSweep(account.getId(), sweepId, new UpdateSweepConfigurationV2()
                .status(active ? UpdateSweepConfigurationV2.StatusEnum.ACTIVE : UpdateSweepConfigurationV2.StatusEnum.INACTIVE)));
    }

    public void deleteSweep(User user, String sweepId) throws Exception {
        BalanceAccount account = businessAccount(user);
        ownedSweep(account.getId(), sweepId);
        balanceAccounts.deleteSweep(account.getId(), sweepId);
    }

    private BalanceAccount businessAccount(User user) throws Exception {
        requireAccountHolder(user);
        if (!bankAccounts.hasBankAccount(user)) throw new BadRequestException("Set up a business account first.");
        String id = bankAccounts.balanceAccountId(user);
        if (id == null || id.isBlank()) throw new BadRequestException("The business balance account could not be found.");
        BalanceAccount account = balanceAccounts.getBalanceAccount(id);
        if (!user.getAccountHolderId().equals(account.getAccountHolderId())) {
            throw new BadRequestException("The balance account does not belong to this account holder.");
        }
        return account;
    }

    private void requireAccountHolder(User user) {
        if (user.getAccountHolderId() == null || user.getLegalEntityId() == null) {
            throw new BadRequestException("Complete account verification first.");
        }
    }

    private Map<String, Capability> capabilityStatus(User user) throws Exception {
        requireAccountHolder(user);
        var raw = accountHolders.getAccountHolder(user.getAccountHolderId()).getCapabilities();
        Map<String, Capability> result = new LinkedHashMap<>();
        for (String name : CAPABILITIES) {
            var value = raw == null ? null : raw.get(name);
            result.put(name, value == null ? new Capability(false, false, false, null) :
                    new Capability(value.getRequested(), value.getAllowed(), value.getEnabled(),
                            value.getVerificationStatus() == null ? null : value.getVerificationStatus().getValue()));
        }
        return result;
    }

    private static AccountHolderCapability capability(AccountHolder holder, String name) {
        return holder == null || holder.getCapabilities() == null ? null : holder.getCapabilities().get(name);
    }

    private void requireCapabilities(User user) throws Exception {
        for (Capability capability : capabilityStatus(user).values()) {
            if (!Boolean.TRUE.equals(capability.allowed()) || !Boolean.TRUE.equals(capability.enabled())) {
                throw new BadRequestException("Direct debit top-ups need account verification and enabled permissions.");
            }
        }
    }

    private void requireInstrument(User user, String id) throws Exception {
        boolean belongs = legalEntities.getPayoutAccounts(user.getLegalEntityId()).stream()
                .anyMatch(a -> Objects.equals(id, a.getTransferInstrumentId()));
        if (!belongs) throw new BadRequestException("Select a bank account linked to your legal entity.");
        String status = bankAccount(id, null).status();
        if ("pending".equals(status) || "actionRequired".equals(status)) {
            throw new BadRequestException("This bank account is not verified yet. Choose a verified bank account.");
        }
    }

    private BankAccount bankAccount(String transferInstrumentId, String referenceIdentifier) {
        try {
            var instrument = transferInstruments.getTransferInstrument(transferInstrumentId);
            var bank = instrument.getBankAccount();
            String number = TopUpRequests.accountNumber(bank);
            String status = TopUpRequests.bankStatus(instrument.getCapabilities() == null ? null : instrument.getCapabilities().values());
            return new BankAccount(transferInstrumentId, number != null ? number : TopUpRequests.masked(referenceIdentifier),
                    bank == null ? null : bank.getBankName(), bank == null ? null : bank.getCountryCode(), status);
        } catch (Exception e) {
            // The masked identifier of the legal entity still lets the user recognise the account.
            return new BankAccount(transferInstrumentId, TopUpRequests.masked(referenceIdentifier), null, null, "unknown");
        }
    }

    private List<SweepConfigurationV2> allSweeps(String accountId) throws Exception {
        List<SweepConfigurationV2> result = new ArrayList<>();
        int limit = 100;
        for (int offset = 0; ; offset += limit) {
            var page = balanceAccounts.getAllSweepsForBalanceAccount(accountId, offset, limit, null).getSweeps();
            if (page == null || page.isEmpty()) return result;
            result.addAll(page);
            if (page.size() < limit) return result;
        }
    }

    private SweepConfigurationV2 ownedSweep(String accountId, String sweepId) throws Exception {
        var sweep = balanceAccounts.getSweep(accountId, sweepId);
        if (!isPull(sweep)) throw new ResourceNotFoundException("Automatic top-up not found.");
        return sweep;
    }

    private boolean isPull(SweepConfigurationV2 sweep) {
        return sweep.getType() == SweepConfigurationV2.TypeEnum.PULL;
    }

    private Sweep toSweep(SweepConfigurationV2 sweep) {
        return new Sweep(sweep.getId(), sweep.getStatus() == null ? null : sweep.getStatus().getValue(),
                sweep.getSchedule() == null || sweep.getSchedule().getType() == null ? null : sweep.getSchedule().getType().getValue(),
                sweep.getSweepAmount() == null ? null : sweep.getSweepAmount().getValue(), sweep.getCurrency(),
                sweep.getCounterparty() == null ? null : sweep.getCounterparty().getTransferInstrumentId(),
                TopUpRequests.minimumBalance(sweep.getTriggerAmount() == null ? null : sweep.getTriggerAmount().getValue()));
    }
}
