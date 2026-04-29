package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.legalentitymanagement.*;
import com.adyen.model.legalentitymanagement.Amount;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.balanceplatform.PaymentInstrumentsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.BusinessLinesApi;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class BankingProvisioningService {

    private final BusinessLinesApi businessLinesApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final PaymentInstrumentsApi paymentInstrumentsApi;

    private static final Map<String, String> COUNTRY_CURRENCY = Map.of(
            "FR", "EUR", "NL", "EUR", "DE", "EUR",
            "US", "USD",
            "GB", "GBP", "UK", "GBP"
    );

    public BankingProvisioningService(@Qualifier("lemClient") Client lemClient,
                                      @Qualifier("balancePlatformClient") Client balancePlatformClient) {
        this.businessLinesApi = new BusinessLinesApi(lemClient);
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        this.paymentInstrumentsApi = new PaymentInstrumentsApi(balancePlatformClient);
    }

    public void createBusinessLine(String legalEntityId, BusinessLineInfo.ServiceEnum service) throws IOException, ApiException {
        List<WebData> webDataList = new ArrayList<>(
                List.of(new WebData().webAddress("http://localhost/"))
        );

        BusinessLineInfo businessLineInfo = new BusinessLineInfo()
                .legalEntityId(legalEntityId)
                .industryCode("4531")
                .service(service)
                .sourceOfFunds(new SourceOfFunds()
                        .adyenProcessedFunds(Boolean.TRUE)
                        .type(SourceOfFunds.TypeEnum.BUSINESS)
                        .amount(new Amount().currency("EUR").value(1000000L)))
                .webData(webDataList);

        businessLinesApi.createBusinessLine(businessLineInfo);
    }

    public PaymentInstrument getPaymentInstrumentDetail(String paymentInstrumentId) throws IOException, ApiException {
        return paymentInstrumentsApi.getPaymentInstrument(paymentInstrumentId);
    }

    public String createBankAccount(String countryCode, String balanceAccountId) throws IOException, ApiException {
        PaymentInstrumentInfo info = new PaymentInstrumentInfo()
                .type(PaymentInstrumentInfo.TypeEnum.BANKACCOUNT)
                .description("Bank Account " + countryCode)
                .balanceAccountId(balanceAccountId);

        if ("FR".equals(countryCode)) {
            info.issuingCountryCode("NL");
            info.bankAccount(new BankAccountModel().formFactor(BankAccountModel.FormFactorEnum.PHYSICAL));
            paymentInstrumentsApi.createPaymentInstrument(info);

            info.issuingCountryCode("FR");
            info.bankAccount(new BankAccountModel().formFactor(BankAccountModel.FormFactorEnum.VIRTUAL));
            return paymentInstrumentsApi.createPaymentInstrument(info).getId();
        } else if (List.of("US", "UK", "GB", "NL").contains(countryCode)) {
            info.issuingCountryCode(countryCode);
            info.bankAccount(new BankAccountModel().formFactor(BankAccountModel.FormFactorEnum.PHYSICAL));
            return paymentInstrumentsApi.createPaymentInstrument(info).getId();
        }

        throw new IllegalArgumentException("Unsupported country code for bank account: " + countryCode);
    }

    public String createBalanceForBusinessAccount(String countryCode, String accountHolderId) throws IOException, ApiException {
        String currencyCode = COUNTRY_CURRENCY.getOrDefault(countryCode, "EUR");

        BalanceAccountInfo balanceAccountInfo = new BalanceAccountInfo()
                .description("Business Bank Account")
                .reference("Business Bank Account")
                .accountHolderId(accountHolderId)
                .defaultCurrencyCode(currencyCode);

        return balanceAccountsApi.createBalanceAccount(balanceAccountInfo).getId();
    }

    public void createSweepAcquiringToBanking(String countryCode, String businessBalanceAccountId, String balanceAccountId) throws IOException, ApiException {
        String currencyCode = COUNTRY_CURRENCY.getOrDefault(countryCode, "EUR");

        CreateSweepConfigurationV2 sweep = new CreateSweepConfigurationV2()
                .type(CreateSweepConfigurationV2.TypeEnum.PUSH)
                .triggerAmount(new com.adyen.model.balanceplatform.Amount().currency(currencyCode).value(0L))
                .currency(currencyCode)
                .category(CreateSweepConfigurationV2.CategoryEnum.INTERNAL)
                .description("Internal Transfer 2min")
                .counterparty(new SweepCounterparty().balanceAccountId(businessBalanceAccountId))
                .schedule(new SweepSchedule().type(SweepSchedule.TypeEnum.CRON).cronExpression("*/2 * * * *"));

        balanceAccountsApi.createSweep(balanceAccountId, sweep);
    }
}
