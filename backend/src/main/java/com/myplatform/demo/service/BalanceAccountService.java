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
                    BalanceAccountInfoCustomer customer = new BalanceAccountInfoCustomer();
                    customer.setCurrencyCode(account.getDefaultCurrencyCode());
                    customer.setDescription(account.getDescription());
                    customer.setBalanceAccountId(account.getId());
                    return customer;
                })
                .toList();
    }

    public BalanceAccountInfoCustomer getOneBalanceAccount(String balanceAccountId) throws IOException, ApiException {
        BalanceAccount balanceAccount = balanceAccountsApi.getBalanceAccount(balanceAccountId);
        BalanceAccountInfoCustomer balanceAccountInfoCustomer = new BalanceAccountInfoCustomer();
        balanceAccountInfoCustomer.setCurrencyCode(balanceAccount.getDefaultCurrencyCode());
        balanceAccountInfoCustomer.setDescription(balanceAccount.getDescription());
        balanceAccountInfoCustomer.setBalanceAccountId(balanceAccount.getId());
        return balanceAccountInfoCustomer;
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
