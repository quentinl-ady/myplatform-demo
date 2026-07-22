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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.*;

import static com.myplatform.demo.service.GpayJwtService.MERCHANT_ID;

@Service
public class StoreManagementService {

    private static final Logger log = LoggerFactory.getLogger(StoreManagementService.class);

    private static final String MGMT_TEST_URL = "https://management-test.adyen.com/v3";

    private final AccountStoreLevelApi accountStoreLevelApi;
    private final PaymentMethodsMerchantLevelApi paymentMethodsMerchantLevelApi;
    private final SplitConfigurationMerchantLevelApi splitConfigurationMerchantLevelApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final LegalEntitiesApi lem;
    private final TerminalsTerminalLevelApi terminalsTerminalLevelApi;
    private final RestTemplate restTemplate;
    private final String pspApiKey;
    private final String merchantAccount;

    public StoreManagementService(@Qualifier("pspClient") Client pspClient,
                                  @Qualifier("balancePlatformClient") Client balancePlatformClient,
                                  @Qualifier("lemClient") Client lemClient,
                                  @Value("${adyen.lemVersion}") String lemVersion,
                                  @Value("${adyen.merchantAccount}") String merchantAccount,
                                  RestTemplate restTemplate) {
        this.accountStoreLevelApi = new AccountStoreLevelApi(pspClient);
        this.paymentMethodsMerchantLevelApi = new PaymentMethodsMerchantLevelApi(pspClient);
        this.splitConfigurationMerchantLevelApi = new SplitConfigurationMerchantLevelApi(pspClient);
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        this.lem = new LegalEntitiesApi(lemClient, "https://kyc-test.adyen.com/lem/" + lemVersion);
        this.terminalsTerminalLevelApi = new TerminalsTerminalLevelApi(pspClient);
        this.restTemplate = restTemplate;
        this.pspApiKey = pspClient.getConfig().getApiKey();
        this.merchantAccount = merchantAccount;
    }

    public StoreCustomer createStore(String legalEntityId, List<String> businessLineId, String city, String country,
                                     String postalCode, String lineAdresse1, String storeReference, String legalEntityName,
                                     String phoneNumber, String balanceAccountId, List<String> paymentMethodRequest,
                                     String userEmail) throws IOException, ApiException {
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

        doRequestPaymentMethods(paymentMethodRequest, businessLineId, store.getId(), country, userEmail);
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

    public void requestPaymentMethod(List<String> paymentMethodRequest, String legalEntityId,
                                      String storeId, String country, String userEmail)
            throws IOException, ApiException {

        List<String> businessLineIds =
                lem.getAllBusinessLinesUnderLegalEntity(legalEntityId)
                        .getBusinessLines()
                        .stream()
                        .filter(bl -> "paymentProcessing".equals(bl.getService().getValue()))
                        .map(BusinessLine::getId)
                        .toList();

        doRequestPaymentMethods(paymentMethodRequest, businessLineIds, storeId, country, userEmail);
    }

    public void requestPaymentMethodForExistingStore(List<String> paymentMethodRequest,
                                                      String storeId, String country, String userEmail)
            throws IOException, ApiException {

        Store adyenStore = accountStoreLevelApi.getStore(merchantAccount, storeId);
        List<String> businessLineIds = adyenStore.getBusinessLineIds();

        doRequestPaymentMethods(paymentMethodRequest, businessLineIds, storeId, country, userEmail);
    }

    private void doRequestPaymentMethods(List<String> paymentMethodRequest, List<String> businessLineIds,
                                          String storeId, String country, String userEmail)
            throws IOException, ApiException {

        Set<String> specificPM = Set.of(
                "cartebancaire", "amex", "googlepay",
                "klarna_b2b", "affirm", "accel", "nyce", "paybybank", "paybybank_plaid",
                "sepadirectdebit"
        );

        for (String blId : businessLineIds) {
            for (String paymentMethod : paymentMethodRequest) {
                if (!specificPM.contains(paymentMethod)) {
                    PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                    info.setBusinessLineId(blId);
                    info.setStoreIds(Collections.singletonList(storeId));
                    info.setType(PaymentMethodSetupInfo.TypeEnum.fromValue(paymentMethod));
                    paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
                }
            }
        }

        if (paymentMethodRequest.contains("cartebancaire")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.CARTEBANCAIRE);
                info.cartesBancaires(new CartesBancairesInfo().siret("54205118000066"));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("amex")) {
            String amexCurrency = getAmexCurrency(country);
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.AMEX);
                info.setCurrencies(new ArrayList<>(List.of(amexCurrency)));
                info.amex(new AmexInfo().serviceLevel(AmexInfo.ServiceLevelEnum.NOCONTRACT));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("googlepay")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.GOOGLEPAY);
                info.googlePay(new GooglePayInfo().reuseMerchantId(Boolean.TRUE).merchantId(MERCHANT_ID));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("klarna_b2b")) {
            requestKlarnaB2b(businessLineIds, storeId, country, userEmail);
        }

        if (paymentMethodRequest.contains("affirm")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.AFFIRM);
                info.affirm(new AffirmInfo().supportEmail(userEmail));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("accel")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.ACCEL);
                info.accel(new AccelInfo().processingType(AccelInfo.ProcessingTypeEnum.ECOM));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("nyce")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.NYCE);
                info.nyce(new NyceInfo().processingType(NyceInfo.ProcessingTypeEnum.ECOM));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("paybybank")) {
            String pbCurrency = "GB".equals(country) ? "GBP" : "EUR";
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.PAYBYBANK);
                info.setCurrencies(new ArrayList<>(List.of(pbCurrency)));
                info.setCountries(new ArrayList<>(List.of(country)));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("paybybank_plaid")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.PAYBYBANK_PLAID);
                info.setCurrencies(new ArrayList<>(List.of("USD")));
                info.setCountries(new ArrayList<>(List.of("US")));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }

        if (paymentMethodRequest.contains("sepadirectdebit")) {
            for (String blId : businessLineIds) {
                PaymentMethodSetupInfo info = new PaymentMethodSetupInfo();
                info.setBusinessLineId(blId);
                info.setStoreIds(Collections.singletonList(storeId));
                info.setType(PaymentMethodSetupInfo.TypeEnum.SEPADIRECTDEBIT);
                info.setCurrencies(new ArrayList<>(List.of("EUR")));
                info.setCountries(new ArrayList<>(List.of(country)));
                info.setSepadirectdebit(new SepaDirectDebitInfo().creditorId("NL48ZZZ342764500000"));
                paymentMethodsMerchantLevelApi.requestPaymentMethod(merchantAccount, info);
            }
        }
    }

    private void requestKlarnaB2b(List<String> businessLineIds, String storeId,
                                   String country, String userEmail) {
        String regionCode = "GB".equals(country) || "FR".equals(country)
                || "DE".equals(country) || "NL".equals(country) ? "EU" : "NA";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-API-Key", pspApiKey);

        for (String blId : businessLineIds) {
            String body = """
                    {
                      "type": "klarna_b2b",
                      "businessLineId": "%s",
                      "storeIds": ["%s"],
                      "klarna": {
                        "autoCapture": true,
                        "disputeEmail": "%s",
                        "supportEmail": "%s",
                        "region": "%s"
                      }
                    }
                    """.formatted(blId, storeId, userEmail, userEmail, regionCode);

            HttpEntity<String> entity = new HttpEntity<>(body, headers);
            try {
                restTemplate.postForEntity(
                        MGMT_TEST_URL + "/merchants/" + merchantAccount + "/paymentMethodSettings",
                        entity, String.class);
            } catch (Exception e) {
                log.error("Failed to request klarna_b2b for store {}: {}", storeId, e.getMessage());
            }
        }
    }

    private String getAmexCurrency(String country) {
        return switch (country) {
            case "US" -> "USD";
            case "GB" -> "GBP";
            default -> "EUR";
        };
    }

    public List<PaymentMethodCustomer> getAllPaymentMethod(String storeId) throws IOException, ApiException {
        PaymentMethodResponse paymentMethodResponse = paymentMethodsMerchantLevelApi.getAllPaymentMethods(merchantAccount, storeId, null, 100, 1, null);
        List<PaymentMethod> paymentMethods = paymentMethodResponse.getData();

        return paymentMethods.stream()
                .map(paymentMethod -> {
                    PaymentMethodCustomer paymentMethodCustomer = new PaymentMethodCustomer();
                    paymentMethodCustomer.setType(paymentMethod.getType());
                    paymentMethodCustomer.setPaymentMethodId(paymentMethod.getId());
                    paymentMethodCustomer.setEnabled(paymentMethod.getEnabled());
                    String verificationStatus = Optional.ofNullable(paymentMethod.getVerificationStatus())
                            .map(PaymentMethod.VerificationStatusEnum::getValue)
                            .orElse("valid");
                    paymentMethodCustomer.setVerificationStatus(verificationStatus);
                    return paymentMethodCustomer;
                })
                .toList();
    }

    public PaymentMethodCustomer togglePaymentMethod(String paymentMethodId, boolean enabled) throws IOException, ApiException {
        UpdatePaymentMethodInfo updateInfo = new UpdatePaymentMethodInfo();
        updateInfo.setEnabled(enabled);
        PaymentMethod updated = paymentMethodsMerchantLevelApi.updatePaymentMethod(merchantAccount, paymentMethodId, updateInfo);

        PaymentMethodCustomer result = new PaymentMethodCustomer();
        result.setType(updated.getType());
        result.setPaymentMethodId(updated.getId());
        result.setEnabled(updated.getEnabled());
        String verificationStatus = Optional.ofNullable(updated.getVerificationStatus())
                .map(PaymentMethod.VerificationStatusEnum::getValue)
                .orElse("valid");
        result.setVerificationStatus(verificationStatus);
        return result;
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
