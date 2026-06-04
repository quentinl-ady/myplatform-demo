package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.service.balanceplatform.AccountHoldersApi;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.balanceplatform.PaymentInstrumentsApi;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.model.BalanceAccountInfoCustomer;
import com.myplatform.demo.model.BankAccountInformationResponse;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;

@Service
public class BalanceAccountService {

    private final AccountHoldersApi accountHoldersApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final PaymentInstrumentsApi paymentInstrumentsApi;

    public BalanceAccountService(@Qualifier("balancePlatformClient") Client balancePlatformClient) {
        this.accountHoldersApi = new AccountHoldersApi(balancePlatformClient);
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        this.paymentInstrumentsApi = new PaymentInstrumentsApi(balancePlatformClient);
    }

    public String createBalanceAccountId(String accountHolderId, String currencyCode) throws IOException, ApiException {
        BalanceAccountInfo balanceAccountInfo = new BalanceAccountInfo()
                .accountHolderId(accountHolderId)
                .defaultCurrencyCode(currencyCode)
                .description("Main Balance Account");

        BalanceAccount balanceAccount = balanceAccountsApi.createBalanceAccount(balanceAccountInfo);
        return balanceAccount.getId();
    }

    public List<BalanceAccountInfoCustomer> getBalanceAccounts(String accountHolderId) throws IOException, ApiException {
        PaginatedBalanceAccountsResponse paginatedBalanceAccountsResponse = accountHoldersApi.getAllBalanceAccountsOfAccountHolder(accountHolderId);
        List<BalanceAccountBase> balanceAccounts = paginatedBalanceAccountsResponse.getBalanceAccounts();

        return balanceAccounts.stream()
                .map(account -> {
                    try {
                        return getDetailedBalanceAccount(account.getId());
                    } catch (Exception e) {
                        BalanceAccountInfoCustomer customer = new BalanceAccountInfoCustomer();
                        customer.setCurrencyCode(account.getDefaultCurrencyCode());
                        customer.setDescription(account.getDescription());
                        customer.setBalanceAccountId(account.getId());
                        return customer;
                    }
                })
                .toList();
    }

    public BalanceAccountInfoCustomer getOneBalanceAccount(String balanceAccountId) throws IOException, ApiException {
        return getDetailedBalanceAccount(balanceAccountId);
    }

    private BalanceAccountInfoCustomer getDetailedBalanceAccount(String balanceAccountId) throws IOException, ApiException {
        BalanceAccount ba = balanceAccountsApi.getBalanceAccount(balanceAccountId);
        BalanceAccountInfoCustomer customer = new BalanceAccountInfoCustomer();
        customer.setCurrencyCode(ba.getDefaultCurrencyCode());
        customer.setDescription(ba.getDescription());
        customer.setBalanceAccountId(ba.getId());
        customer.setStatus(ba.getStatus() != null ? ba.getStatus().getValue() : null);

        if (ba.getBalances() != null) {
            customer.setBalances(ba.getBalances().stream().map(b -> {
                BalanceAccountInfoCustomer.BalanceInfo info = new BalanceAccountInfoCustomer.BalanceInfo();
                info.setCurrency(b.getCurrency());
                info.setAvailable(b.getAvailable() != null ? b.getAvailable() : 0);
                info.setBalance(b.getBalance() != null ? b.getBalance() : 0);
                info.setPending(b.getPending() != null ? b.getPending() : 0);
                info.setReserved(b.getReserved() != null ? b.getReserved() : 0);
                return info;
            }).toList());
        }

        try {
            BalanceSweepConfigurationsResponse sweepList = balanceAccountsApi.getAllSweepsForBalanceAccount(balanceAccountId);
            if (sweepList.getSweeps() != null) {
                customer.setSweeps(sweepList.getSweeps().stream().map(s -> {
                    BalanceAccountInfoCustomer.SweepInfo sweep = new BalanceAccountInfoCustomer.SweepInfo();
                    sweep.setId(s.getId());
                    sweep.setCurrency(s.getCurrency());
                    sweep.setDescription(s.getDescription());
                    sweep.setCategory(s.getCategory() != null ? s.getCategory().getValue() : null);
                    sweep.setType(s.getType() != null ? s.getType().getValue() : null);
                    sweep.setStatus(s.getStatus() != null ? s.getStatus().getValue() : null);
                    if (s.getSchedule() != null) {
                        sweep.setScheduleType(s.getSchedule().getType().toString());
                        sweep.setCronExpression(s.getSchedule().getCronExpression());
                    }
                    if (s.getCounterparty() != null) {
                        sweep.setCounterpartyTransferInstrumentId(s.getCounterparty().getTransferInstrumentId());
                        sweep.setCounterpartyBalanceAccountId(s.getCounterparty().getBalanceAccountId());
                    }
                    if (s.getPriorities() != null) {
                        sweep.setPriorities(s.getPriorities().stream().map(p -> p.getValue()).toList());
                    }
                    return sweep;
                }).toList());
            }
        } catch (Exception ignored) {}

        return customer;
    }

    public BalanceAccount createNewBalanceAccount(String accountHolderId, String description) throws IOException, ApiException {
        BalanceAccountInfo balanceAccountInfo = new BalanceAccountInfo()
                .accountHolderId(accountHolderId)
                .description(description != null && !description.isBlank() ? description : "Balance Account");

        return balanceAccountsApi.createBalanceAccount(balanceAccountInfo);
    }

    public String findBusinessBankBalanceAccountId(String accountHolderId) throws IOException, ApiException {
        PaginatedBalanceAccountsResponse response = accountHoldersApi.getAllBalanceAccountsOfAccountHolder(accountHolderId);
        if (response.getBalanceAccounts() == null) return null;
        return response.getBalanceAccounts().stream()
                .filter(ba -> "Business Bank Account".equals(ba.getDescription()))
                .map(BalanceAccountBase::getId)
                .findFirst()
                .orElse(null);
    }

    public String getBalanceAccountIdForPaymentInstrument(String paymentInstrumentId) throws IOException, ApiException {
        PaymentInstrument paymentInstrument = paymentInstrumentsApi.getPaymentInstrument(paymentInstrumentId);
        return paymentInstrument.getBalanceAccountId();
    }

    public String getPhysicalBankAccountId(String balanceAccountId) throws IOException, ApiException {
        PaginatedPaymentInstrumentsResponse response =
                balanceAccountsApi.getPaymentInstrumentsLinkedToBalanceAccount(balanceAccountId);
        if (response.getPaymentInstruments() == null) return null;
        return response.getPaymentInstruments().stream()
                .filter(pi -> pi.getType() == PaymentInstrument.TypeEnum.BANKACCOUNT)
                .filter(pi -> pi.getBankAccount() != null && "physical".equalsIgnoreCase(pi.getBankAccount().getFormFactor()))
                .map(PaymentInstrument::getId)
                .findFirst()
                .orElse(null);
    }

    public BankAccountInformationResponse getBankAccountInformation(String bankAccountId, String userCurrency) throws IOException, ApiException {
        BankAccountInformationResponse bankAccountInformationResponse = new BankAccountInformationResponse();
        PaymentInstrument paymentInstrument = paymentInstrumentsApi.getPaymentInstrument(bankAccountId);
        BalanceAccount balanceAccount = balanceAccountsApi.getBalanceAccount(paymentInstrument.getBalanceAccountId());

        Balance matchingBalance = balanceAccount.getBalances().stream()
                .filter(b -> userCurrency != null && userCurrency.equalsIgnoreCase(b.getCurrency()))
                .findFirst()
                .orElse(balanceAccount.getBalances().get(0));

        bankAccountInformationResponse.setCurrency(matchingBalance.getCurrency());
        bankAccountInformationResponse.setAmount(matchingBalance.getAvailable());
        bankAccountInformationResponse.setDescription(paymentInstrument.getDescription());

        return bankAccountInformationResponse;
    }
}
