package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.legalentitymanagement.BusinessLine;
import com.adyen.model.management.*;
import com.adyen.model.management.PaymentMethod;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.LegalEntitiesApi;
import com.adyen.service.management.AccountStoreLevelApi;
import com.adyen.service.management.PaymentMethodsMerchantLevelApi;
import com.adyen.service.management.SplitConfigurationMerchantLevelApi;
import com.adyen.service.management.TerminalsTerminalLevelApi;
import com.myplatform.demo.model.PaymentMethodCustomer;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.model.TerminalResponse;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;

import static com.myplatform.demo.service.GpayJwtService.MERCHANT_ID;

@Service
public class StoreManagementService {

    private final AccountStoreLevelApi accountStoreLevelApi;
    private final PaymentMethodsMerchantLevelApi paymentMethodsMerchantLevelApi;
    private final SplitConfigurationMerchantLevelApi splitConfigurationMerchantLevelApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final LegalEntitiesApi lem;
    private final TerminalsTerminalLevelApi terminalsTerminalLevelApi;
    private final String merchantAccount;

    public StoreManagementService(@Qualifier("pspClient") Client pspClient,
                                  @Qualifier("balancePlatformClient") Client balancePlatformClient,
                                  @Qualifier("lemClient") Client lemClient,
                                  @Value("${adyen.lemVersion}") String lemVersion,
                                  @Value("${adyen.merchantAccount}") String merchantAccount) {
        this.accountStoreLevelApi = new AccountStoreLevelApi(pspClient);
        this.paymentMethodsMerchantLevelApi = new PaymentMethodsMerchantLevelApi(pspClient);
        this.splitConfigurationMerchantLevelApi = new SplitConfigurationMerchantLevelApi(pspClient);
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        this.lem = new LegalEntitiesApi(lemClient, "https://kyc-test.adyen.com/lem/" + lemVersion);
        this.terminalsTerminalLevelApi = new TerminalsTerminalLevelApi(pspClient);
        this.merchantAccount = merchantAccount;
    }

    public StoreCustomer createStore(String legalEntityId, List<String> businessLineId, String city, String country,
                                     String postalCode, String lineAdresse1, String storeReference, String legalEntityName,
                                     String phoneNumber, String balanceAccountId, List<String> paymentMethodRequest) throws IOException, ApiException {
        StoreCreationRequest storeCreationRequest = new StoreCreationRequest();

        storeCreationRequest.setBusinessLineIds(businessLineId);
        StoreLocation storeLocation = new StoreLocation()
                .city(city)
                .country(country)
                .postalCode(postalCode)
                .line1(lineAdresse1);

        if (country.equals("UK")) {
            country = "GB";
        }
        if (country.equals("US")) {
            storeLocation.setStateOrProvince("NY");
        }

        storeCreationRequest.address(storeLocation);
        storeCreationRequest.setDescription("MyPlatform " + storeReference);
        storeCreationRequest.setReference(storeReference);
        storeCreationRequest.setShopperStatement(legalEntityName);
        storeCreationRequest.setPhoneNumber(phoneNumber);
        StoreSplitConfiguration storeSplitConfiguration = new StoreSplitConfiguration();
        storeSplitConfiguration.setBalanceAccountId(balanceAccountId);
        storeSplitConfiguration.setSplitConfigurationId(createSplitConfiguration(balanceAccountId).getSplitConfigurationId());

        storeCreationRequest.setSplitConfiguration(storeSplitConfiguration);

        Store store = accountStoreLevelApi.createStoreByMerchantId(merchantAccount, storeCreationRequest);

        requestPaymentMethod(paymentMethodRequest, legalEntityId, store.getId());
        StoreCustomer storeCustomer = new StoreCustomer();
        storeCustomer.setStoreRef(storeReference);
        storeCustomer.setCity(city);
        storeCustomer.setCountry(country);
        storeCustomer.setLineAdresse(lineAdresse1);
        storeCustomer.setPhoneNumber(phoneNumber);
        storeCustomer.setStoreId(store.getId());

        return storeCustomer;
    }

    public SplitConfiguration createSplitConfiguration(String balanceAccountId) throws IOException, ApiException {
        String currencyCode = balanceAccountsApi.getBalanceAccount(balanceAccountId).getDefaultCurrencyCode();

        List<SplitConfiguration> splitConfigurationList = splitConfigurationMerchantLevelApi.listSplitConfigurations(this.merchantAccount).getData();
        String description = "DEFAULT CONTRACT 01/04/2026 myPlatform.com " + currencyCode;

        SplitConfiguration splitConfiguration1 = splitConfigurationList.stream()
                .filter(sc -> description.equals(sc.getDescription()))
                .findFirst()
                .orElse(null);

        if (splitConfiguration1 == null) {
            SplitConfiguration splitConfiguration = new SplitConfiguration();
            splitConfiguration.setDescription(description);
            List<SplitConfigurationRule> rules = new ArrayList<>();

            rules.add(new SplitConfigurationRule()
                    .currency(currencyCode)
                    .fundingSource(SplitConfigurationRule.FundingSourceEnum.ANY)
                    .paymentMethod("ANY")
                    .shopperInteraction(SplitConfigurationRule.ShopperInteractionEnum.ANY)
                    .splitLogic(new SplitConfigurationLogic()
                            .refund(SplitConfigurationLogic.RefundEnum.DEDUCTACCORDINGTOSPLITRATIO)
                            .commission(new Commission().variablePercentage(1000L))
                            .paymentFee(SplitConfigurationLogic.PaymentFeeEnum.DEDUCTFROMLIABLEACCOUNT)));

            rules.add(new SplitConfigurationRule()
                    .currency("ANY")
                    .fundingSource(SplitConfigurationRule.FundingSourceEnum.ANY)
                    .paymentMethod("ANY")
                    .shopperInteraction(SplitConfigurationRule.ShopperInteractionEnum.ANY)
                    .splitLogic(new SplitConfigurationLogic()
                            .refund(SplitConfigurationLogic.RefundEnum.DEDUCTACCORDINGTOSPLITRATIO)
                            .commission(new Commission().variablePercentage(2000L))
                            .paymentFee(SplitConfigurationLogic.PaymentFeeEnum.DEDUCTFROMLIABLEACCOUNT)));
            splitConfiguration.setRules(rules);

            return splitConfigurationMerchantLevelApi.createSplitConfiguration(merchantAccount, splitConfiguration);
        } else {
            return splitConfiguration1;
        }
    }

    public void requestPaymentMethod(List<String> paymentMethodRequest, String legalEntityId, String storeId)
            throws IOException, ApiException {

        List<BusinessLine> businessLines =
                lem.getAllBusinessLinesUnderLegalEntity(legalEntityId)
                        .getBusinessLines()
                        .stream()
                        .filter(bl -> "paymentProcessing".equals(bl.getService().getValue()))
                        .toList();

        List<String> specificPM = new ArrayList<>(List.of("cartebancaire", "amex", "googlepay"));

        for (BusinessLine businessLine : businessLines) {
            for (String paymentMethod : paymentMethodRequest) {
                if (!specificPM.contains(paymentMethod)) {
                    PaymentMethodSetupInfo paymentMethodSetupInfo = new PaymentMethodSetupInfo();
                    paymentMethodSetupInfo.setBusinessLineId(businessLine.getId());
                    paymentMethodSetupInfo.setStoreIds(Collections.singletonList(storeId));
                    paymentMethodSetupInfo.setType(PaymentMethodSetupInfo.TypeEnum.fromValue(paymentMethod));
                    paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, paymentMethodSetupInfo);
                }
            }
        }

        if (paymentMethodRequest.contains("cartebancaire")) {
            for (BusinessLine businessLine : businessLines) {
                PaymentMethodSetupInfo paymentMethodSetupInfo = new PaymentMethodSetupInfo();
                paymentMethodSetupInfo.setBusinessLineId(businessLine.getId());
                paymentMethodSetupInfo.setStoreIds(Collections.singletonList(storeId));
                paymentMethodSetupInfo.setType(PaymentMethodSetupInfo.TypeEnum.fromValue("cartebancaire"));
                paymentMethodSetupInfo.cartesBancaires(new CartesBancairesInfo().siret("54205118000066"));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, paymentMethodSetupInfo);
            }
        }

        if (paymentMethodRequest.contains("amex")) {
            for (BusinessLine businessLine : businessLines) {
                PaymentMethodSetupInfo paymentMethodSetupInfo = new PaymentMethodSetupInfo();
                paymentMethodSetupInfo.setBusinessLineId(businessLine.getId());
                paymentMethodSetupInfo.setStoreIds(Collections.singletonList(storeId));
                paymentMethodSetupInfo.setType(PaymentMethodSetupInfo.TypeEnum.fromValue("amex"));
                paymentMethodSetupInfo.setCurrencies(new ArrayList<>(List.of("EUR")));
                paymentMethodSetupInfo.amex(new AmexInfo().serviceLevel(AmexInfo.ServiceLevelEnum.NOCONTRACT));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, paymentMethodSetupInfo);
            }
        }

        if (paymentMethodRequest.contains("googlepay")) {
            for (BusinessLine businessLine : businessLines) {
                PaymentMethodSetupInfo paymentMethodSetupInfo = new PaymentMethodSetupInfo();
                paymentMethodSetupInfo.setBusinessLineId(businessLine.getId());
                paymentMethodSetupInfo.setStoreIds(Collections.singletonList(storeId));
                paymentMethodSetupInfo.setType(PaymentMethodSetupInfo.TypeEnum.fromValue("googlepay"));
                paymentMethodSetupInfo.googlePay(new GooglePayInfo().reuseMerchantId(Boolean.TRUE).merchantId(MERCHANT_ID));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, paymentMethodSetupInfo);
            }
        }
    }

    public List<PaymentMethodCustomer> getAllPaymentMethod(String storeId) throws IOException, ApiException {
        PaymentMethodResponse paymentMethodResponse = paymentMethodsMerchantLevelApi.getAllPaymentMethods(merchantAccount, storeId, null, 100, 1, null);
        List<PaymentMethod> paymentMethods = paymentMethodResponse.getData();

        return paymentMethods.stream()
                .map(paymentMethod -> {
                    PaymentMethodCustomer paymentMethodCustomer = new PaymentMethodCustomer();
                    paymentMethodCustomer.setType(paymentMethod.getType());
                    String verificationStatus = Optional.ofNullable(paymentMethod.getVerificationStatus())
                            .map(PaymentMethod.VerificationStatusEnum::getValue)
                            .orElse("valid");
                    paymentMethodCustomer.setVerificationStatus(verificationStatus);
                    return paymentMethodCustomer;
                })
                .toList();
    }

    public List<TerminalResponse> listTerminals(String storeId) throws IOException, ApiException {
        ListTerminalsResponse listTerminalsResponses = terminalsTerminalLevelApi.listTerminals(null, null, null, null, storeId, null, null, null, null);
        List<Terminal> terminalList = listTerminalsResponses.getData();
        if (terminalList == null || terminalList.isEmpty()) {
            return List.of();
        }

        return terminalList.stream()
                .map(terminal -> {
                    TerminalResponse response = new TerminalResponse();
                    response.setId(terminal.getId());
                    response.setModel(terminal.getModel());
                    if (terminal.getAssignment() != null && terminal.getAssignment().getStatus() != null) {
                        response.setStatus(terminal.getAssignment().getStatus().toString());
                    }
                    return response;
                })
                .toList();
    }
}
