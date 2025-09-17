package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.enums.Environment;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.balanceplatform.IbanAccountIdentification;
import com.adyen.model.checkout.*;
import com.adyen.model.checkout.Amount;
import com.adyen.model.legalentitymanagement.*;
import com.adyen.model.legalentitymanagement.Address;
import com.adyen.model.legalentitymanagement.CALocalAccountIdentification;
import com.adyen.model.legalentitymanagement.JSON;
import com.adyen.model.legalentitymanagement.Name;
import com.adyen.model.management.*;
import com.adyen.model.management.PaymentMethod;
import com.adyen.service.balanceplatform.AccountHoldersApi;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.checkout.PaymentsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.BusinessLinesApi;
import com.adyen.service.legalentitymanagement.HostedOnboardingApi;
import com.adyen.service.legalentitymanagement.LegalEntitiesApi;
import com.adyen.service.legalentitymanagement.TransferInstrumentsApi;
import com.adyen.service.management.AccountStoreLevelApi;
import com.adyen.service.management.PaymentMethodsMerchantLevelApi;
import com.adyen.service.management.SplitConfigurationMerchantLevelApi;
import com.myplatform.demo.model.*;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

import static java.util.Objects.isNull;
import static java.util.stream.Collectors.toList;

@Service
public class AdyenService {
    private final LegalEntitiesApi lem;
    private final TransferInstrumentsApi transferInstrumentsApi;
    private final HostedOnboardingApi hop;
    private final AccountHoldersApi accountHoldersApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final BusinessLinesApi businessLinesApi;
    private final String balancePlatformApiKey;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final AccountStoreLevelApi accountStoreLevelApi;
    private final PaymentMethodsMerchantLevelApi paymentMethodsMerchantLevelApi;
    private final SplitConfigurationMerchantLevelApi splitConfigurationMerchantLevelApi;
    private final PaymentsApi paymentsApi;
    private final String merchantAccount;
    @Getter
    private final String clientKey;

    private final StoreCustomerRepository storeCustomerRepository;
    private final UserRepository userRepository;

    Map<String, String> languageMap = Map.of(
            "FR", "fr-FR",
            "DE", "de-DE",
            "NL", "nl-NL",
            "GB", "en-EN",
            "US", "en-US"
    );


    public AdyenService(@Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                        @Value("${adyen.pspApiKey}") String pspApiKey,
                        @Value("${adyen.merchantAccount}") String merchantAccount,
                        @Value("${adyen.clientKey}") String clientKey,
                        StoreCustomerRepository storeCustomerRepository, UserRepository userRepository) {
        Client balancePlatformClient = new Client(balancePlatformApiKey, Environment.TEST);
        Client pspClient = new Client(pspApiKey, Environment.TEST);

        lem = new LegalEntitiesApi(balancePlatformClient);
        transferInstrumentsApi = new TransferInstrumentsApi(balancePlatformClient);
        hop = new HostedOnboardingApi(balancePlatformClient);
        accountHoldersApi = new AccountHoldersApi(balancePlatformClient);
        balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        businessLinesApi = new BusinessLinesApi(balancePlatformClient);
        this.balancePlatformApiKey = balancePlatformApiKey;

        accountStoreLevelApi = new AccountStoreLevelApi(pspClient);
        paymentMethodsMerchantLevelApi = new PaymentMethodsMerchantLevelApi(pspClient);
        splitConfigurationMerchantLevelApi = new SplitConfigurationMerchantLevelApi(pspClient);
        this.merchantAccount = merchantAccount;

        paymentsApi = new PaymentsApi(pspClient);

        httpClient = HttpClient.newHttpClient();
        objectMapper = new ObjectMapper();

        this.storeCustomerRepository = storeCustomerRepository;

        this.clientKey = clientKey;
        this.userRepository = userRepository;
    }

    public String createLegalEntity(User user) throws IOException, ApiException {

        Address address = new Address()
                .country(user.getCountryCode());

        switch (user.getUserType()) {
            case "organization" -> {

                Organization organization = new Organization()
                        .legalName(user.getLegalEntityName())
                        .registeredAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredType = new LegalEntityInfoRequiredType()
                        .organization(organization)
                        .type(LegalEntityInfoRequiredType.TypeEnum.ORGANIZATION);

                LegalEntity response = lem.createLegalEntity(legalEntityInfoRequiredType);
                return response.getId();

            }
            case "individual" -> {

                Individual individual = new Individual()
                        .name(new Name().firstName(user.getFirstName())
                                .lastName(user.getLastName()))
                        .residentialAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredType = new LegalEntityInfoRequiredType()
                        .individual(individual)
                        .type(LegalEntityInfoRequiredType.TypeEnum.INDIVIDUAL);

                LegalEntity response = lem.createLegalEntity(legalEntityInfoRequiredType);
                return response.getId();

            }
            case "soleProprietorship" -> {

                SoleProprietorship soleProprietorship = new SoleProprietorship()
                        .name(user.getLegalEntityName())
                        .countryOfGoverningLaw(user.getCountryCode())
                        .registeredAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredType = new LegalEntityInfoRequiredType()
                        .soleProprietorship(soleProprietorship)
                        .type(LegalEntityInfoRequiredType.TypeEnum.SOLEPROPRIETORSHIP);

                LegalEntity response = lem.createLegalEntity(legalEntityInfoRequiredType);
                return response.getId();
            }
            default -> {
                return null;
            }
        }
    }

    public String createHOP(String legalEntityId, String countryCode, Long userId) throws IOException, ApiException {
        String languageCode = languageMap.getOrDefault(countryCode.toUpperCase(), "en-US");

        OnboardingLinkInfo onboardingLinkInfo = new OnboardingLinkInfo()
                .locale(languageCode)
                .redirectUrl("http://localhost:4200/" + userId + "/dashboard");

        OnboardingLink link = hop.getLinkToAdyenhostedOnboardingPage(legalEntityId, onboardingLinkInfo);

        return link.getUrl();
    }


    public String createAccountHolder(String legalEntityId, String activityReason, Boolean capital, Boolean bank, Boolean issuing) throws IOException, ApiException {
        AccountHolderInfo accountHolderInfo = new AccountHolderInfo()
                .legalEntityId(legalEntityId)
                .reference(String.valueOf(System.currentTimeMillis()));

        Map<String, AccountHolderCapability> capabilities = new HashMap<>(Map.of(
                "receiveFromBalanceAccount", new AccountHolderCapability().enabled(true).requested(true),
                "sendToBalanceAccount", new AccountHolderCapability().enabled(true).requested(true),
                "sendToTransferInstrument", new AccountHolderCapability().enabled(true).requested(true),
                "receiveFromPlatformPayments", new AccountHolderCapability().enabled(true).requested(true)

        ));

        if (activityReason.equals("marketplace")) {
            capabilities.put("receivePayments", new AccountHolderCapability().enabled(false).requested(false));
        } else {
            capabilities.put("receivePayments", new AccountHolderCapability().enabled(true).requested(true));
        }

        if (capital) {
            capabilities.put("receiveGrants", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("getGrantOffers", new AccountHolderCapability().enabled(true).requested(true));
        } else {
            capabilities.put("receiveGrants", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("getGrantOffers", new AccountHolderCapability().enabled(false).requested(false));
        }

        if (bank) {
            capabilities.put("issueBankAccount", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("sendToThirdParty", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("receiveFromThirdParty", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("receiveFromTransferInstrument", new AccountHolderCapability().enabled(true).requested(true));
        } else {
            capabilities.put("issueBankAccount", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("sendToThirdParty", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("receiveFromThirdParty", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("receiveFromTransferInstrument", new AccountHolderCapability().enabled(false).requested(false));
        }

        if (issuing) {
            capabilities.put("issueCard", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("useCard", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("useCardInRestrictedCountries", new AccountHolderCapability().enabled(true).requested(true).requestedLevel(AccountHolderCapability.RequestedLevelEnum.MEDIUM));
        } else {
            capabilities.put("issueCard", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("useCard", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("useCardInRestrictedCountries", new AccountHolderCapability().enabled(false).requested(false));
        }

        accountHolderInfo.setCapabilities(capabilities);

        AccountHolder accountHolder = accountHoldersApi.createAccountHolder(accountHolderInfo);
        return accountHolder.getId();
    }

    public KycStatus getLegalEntityKycDetail(String legalEntityId, String activityReason, Boolean bank, Boolean capital, Boolean issuing) throws IOException, ApiException {
        KycStatus kycStatus = new KycStatus();
        Status acquiring = new Status();
        Status payout = new Status();

        LegalEntity legalEntity = lem.getLegalEntity(legalEntityId);
        Map<String, LegalEntityCapability> map = legalEntity.getCapabilities();

        LegalEntityCapability acquiringCapability;

        if (activityReason.equals("embeddedPayment")) {
            acquiringCapability = map.get("receivePayments");
        } else {
            acquiringCapability = map.get("receiveFromPlatformPayments");
        }
        LegalEntityCapability sendToTransferInstrument = map.get("sendToTransferInstrument");

        if (bank) {
            LegalEntityCapability issueBankAccountCapability = map.get("issueBankAccount");
            Status issueBankAccount = new Status();
            issueBankAccount.setAllowed(issueBankAccountCapability.getAllowed());
            issueBankAccount.setVerificationStatus(issueBankAccountCapability.getVerificationStatus());
            kycStatus.setBankingStatus(issueBankAccount);
        }
        if (capital) {
            LegalEntityCapability receiveGrantsCapability = map.get("receiveGrants");
            Status receiveGrants = new Status();
            receiveGrants.setAllowed(receiveGrantsCapability.getAllowed());
            receiveGrants.setVerificationStatus(receiveGrantsCapability.getVerificationStatus());
            kycStatus.setCapitalStatus(receiveGrants);
        }
        if (issuing) {
            LegalEntityCapability issueCardCapability = map.get("issueCardCommercial");
            Status issueCard = new Status();
            issueCard.setAllowed(issueCardCapability.getAllowed());
            issueCard.setVerificationStatus(issueCardCapability.getVerificationStatus());
            kycStatus.setIssuingStatus(issueCard);
        }

        acquiring.setAllowed(acquiringCapability.getAllowed());
        acquiring.setVerificationStatus(acquiringCapability.getVerificationStatus());

        payout.setAllowed(sendToTransferInstrument.getAllowed());
        payout.setVerificationStatus(sendToTransferInstrument.getVerificationStatus());

        kycStatus.setAcquiringStatus(acquiring);
        kycStatus.setPayoutStatus(payout);

        return kycStatus;
    }

    public String createBalanceAccountId(String accountHolderId, String currencyCode) throws IOException, ApiException {
        BalanceAccountInfo balanceAccountInfo = new BalanceAccountInfo()
                .accountHolderId(accountHolderId)
                .defaultCurrencyCode(currencyCode)
                .description("Main Balance Account");

        BalanceAccount balanceAccount = balanceAccountsApi.createBalanceAccount(balanceAccountInfo);
        return balanceAccount.getId();
    }

    public Activity createBusinessLine(Activity activity, String legalEntityId) throws IOException, ApiException {
        BusinessLineInfo businessLineInfo = new BusinessLineInfo()
                .legalEntityId(legalEntityId)
                .industryCode(activity.getIndustryCode())
                .salesChannels(activity.getSalesChannels())
                .addWebDataItem(new WebData().webAddress("http://localhost"))
                .service(BusinessLineInfo.ServiceEnum.PAYMENTPROCESSING);

        BusinessLine businessLine = businessLinesApi.createBusinessLine(businessLineInfo);
        activity.setId(businessLine.getId());
        return activity;
    }

    public List<Activity> getBusinessLine(String legalEntityId) throws IOException, ApiException {
        List<BusinessLine> businessLines =
                lem.getAllBusinessLinesUnderLegalEntity(legalEntityId).getBusinessLines();

        if (businessLines == null || businessLines.isEmpty()) {
            return List.of();
        }

        return businessLines.stream()
                .map(businessLine -> {
                    Activity activity = new Activity();
                    activity.setId(businessLine.getId());
                    activity.setIndustryCode(businessLine.getIndustryCode());
                    if (businessLine.getSalesChannels() != null) {
                        activity.setSalesChannels(businessLine.getSalesChannels());
                    }
                    return activity;
                })
                .toList();
    }


    public String createSession(String accountHolderId, String[] v2) throws Exception {
        Map<String, Object> requestBody = Map.of(
                "allowOrigin", "http://localhost",
                "product", "platform",
                "policy", Map.of(
                        "resources", new Map[]{Map.of(
                                "accountHolderId", accountHolderId,
                                "type", "accountHolder"
                        )},
                        "roles", v2
                )
        );

        String json = objectMapper.writeValueAsString(requestBody);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://test.adyen.com/authe/api/v1/sessions"))
                .header("Content-Type", "application/json")
                .header("x-api-key", balancePlatformApiKey)
                .POST(BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());

        if (response.statusCode() >= 200 && response.statusCode() < 300) {
            return response.body();
        } else {
            throw new RuntimeException("Error create session: " + response.body());
        }
    }

    public List<BalanceAccountInfoCustomer> getBalanceAccount(String accountHolderId) throws IOException, ApiException {
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


    public StoreCustomer createStore(String legalEntityId, List<String> businessLineId, String city, String country, String postalCode, String lineAdresse1, String storeReference, String legalEntityName, String phoneNumber, String balanceAccountId, List<String> paymentMethodRequest) throws IOException, ApiException {
        StoreCreationRequest storeCreationRequest = new StoreCreationRequest();


        storeCreationRequest.setBusinessLineIds(businessLineId);
        StoreLocation storeLocation = new StoreLocation()
                .city(city)
                .country(country)
                .postalCode(postalCode)
                .line1(lineAdresse1);

        if (country.equals("US")) {
            storeLocation.setPostalCode("NY"); //workaround, keep the UI simple.
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
        String description = "DEFAULT CONTRACT myPlatform.com " + currencyCode;

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
                            .commission(new Commission()
                                    .variablePercentage(1000L))
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
                lem.getAllBusinessLinesUnderLegalEntity(legalEntityId).getBusinessLines();

        List<String> specificPM = new ArrayList<>(List.of("cartebancaire", "amex"));

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
                paymentMethodSetupInfo.amex(new AmexInfo().serviceLevel(AmexInfo.ServiceLevelEnum.NOCONTRACT));
                paymentMethodSetupInfo.setCurrencies(new ArrayList<>(List.of("EUR")));

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
                    paymentMethodCustomer.setVerificationStatus(paymentMethod.getVerificationStatus().getValue());
                    return paymentMethodCustomer;
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

    public PaymentSessionResponse createPaymentSession(String currencyCode, Long amount, String reference, Long userId, String storeRef, String activityReason, String balanceAccountId) throws IOException, ApiException {

        CreateCheckoutSessionRequest createCheckoutSessionRequest = new CreateCheckoutSessionRequest()
                .reference(reference)
                .amount(new Amount().currency(currencyCode).value(amount))
                .merchantAccount(this.merchantAccount)
                .channel(CreateCheckoutSessionRequest.ChannelEnum.WEB)
                .shopperEmail("john.doe@gmail.com")
                .shopperIP("192.168.1.1")
                .shopperName(new com.adyen.model.checkout.Name().firstName("John").lastName("Doe"))
                .dateOfBirth(LocalDate.of(1990, 1, 1))
                .captureDelayHours(0) //force autocapture
                .telephoneNumber("+33610101010")
                .returnUrl("http://localhost:4000/" + userId + "/payment");

        if (activityReason.equals("embeddedPayment")) {
            createCheckoutSessionRequest.setStore(storeRef);
            StoreCustomer storeCustomer = this.storeCustomerRepository.findByStoreRef(storeRef);
            createCheckoutSessionRequest.setCountryCode(storeCustomer.getCountry());
        }
        { // marketplace
            List<Split> splits = new ArrayList<>();

            long commissionAmount = Math.round(amount * 0.10); // 10% commission
            long sellerAmount = amount - commissionAmount;

            Split sellerSplit = new Split();
            sellerSplit.setAmount(new SplitAmount().currency(currencyCode).value(sellerAmount));
            sellerSplit.setType(Split.TypeEnum.BALANCEACCOUNT);
            sellerSplit.setAccount(balanceAccountId);
            sellerSplit.setReference("SELLER_" + reference);

            Split platformSplit = new Split();
            platformSplit.setAmount(new SplitAmount().currency(currencyCode).value(commissionAmount));
            platformSplit.setType(Split.TypeEnum.COMMISSION);
            platformSplit.setReference("PLATFORM_FEE_" + reference);

            splits.add(sellerSplit);
            splits.add(platformSplit);

            createCheckoutSessionRequest.setSplits(splits);

            long totalSplits = splits.stream().mapToLong(s -> s.getAmount().getValue()).sum();
            if (totalSplits != amount) {
                throw new IllegalStateException("The sum of the splits (" + totalSplits + ") does not match the total amount (" + amount + ")");
            }
        }

        CreateCheckoutSessionResponse response = paymentsApi.sessions(createCheckoutSessionRequest);

        PaymentSessionResponse paymentSessionResponse = new PaymentSessionResponse();
        paymentSessionResponse.setId(response.getId());
        paymentSessionResponse.setSessionData(response.getSessionData());
        paymentSessionResponse.setAmount(amount);
        paymentSessionResponse.setCurrency(currencyCode);
        return paymentSessionResponse;
    }

    public List<PayoutAccount> getPayoutAccount(String legalEntityId) throws IOException, ApiException {
        LegalEntity legalEntity = lem.getLegalEntity(legalEntityId);

        List<TransferInstrumentReference> transferInstruments =
                Optional.ofNullable(legalEntity.getTransferInstruments())
                        .orElse(Collections.emptyList());

        return transferInstruments.stream()
                .filter(Objects::nonNull)
                .map(ref -> new PayoutAccount(
                        ref.getId(),
                        ref.getAccountIdentifier()
                ))
                .toList();
    }

    public PayoutConfigurationResponse createPayoutConfiguration(String balanceAccountId, String currencyCode, Boolean regular, Boolean instant, String transferInstrumentId, String schedule) throws IOException, ApiException {

        String accountIdentifier = getAccountIdentifier(transferInstrumentId);

        CreateSweepConfigurationV2 createSweepConfigurationV2 = new CreateSweepConfigurationV2();
        createSweepConfigurationV2.type(CreateSweepConfigurationV2.TypeEnum.PUSH);
        createSweepConfigurationV2.triggerAmount(new com.adyen.model.balanceplatform.Amount().currency(currencyCode).value(0L));
        createSweepConfigurationV2.currency(currencyCode);
        createSweepConfigurationV2.category(CreateSweepConfigurationV2.CategoryEnum.BANK);
        if (regular) {
            createSweepConfigurationV2.addPrioritiesItem(CreateSweepConfigurationV2.PrioritiesEnum.REGULAR);
        }
        if (instant) {
            createSweepConfigurationV2.addPrioritiesItem(CreateSweepConfigurationV2.PrioritiesEnum.INSTANT);
        }
        SweepCounterparty sweepCounterparty = new SweepCounterparty();
        sweepCounterparty.setTransferInstrumentId(transferInstrumentId);


        SweepSchedule sweepSchedule = new SweepSchedule().type(SweepSchedule.TypeEnum.fromValue(schedule));
        createSweepConfigurationV2.setSchedule(sweepSchedule);
        createSweepConfigurationV2.counterparty(sweepCounterparty);
        createSweepConfigurationV2.description("Payout for " + balanceAccountId);
        balanceAccountsApi.createSweep(balanceAccountId, createSweepConfigurationV2);

        PayoutConfigurationResponse payoutConfigurationResponse = new PayoutConfigurationResponse();
        payoutConfigurationResponse.setAccountIdentifier(accountIdentifier);
        payoutConfigurationResponse.setBalanceAccountId(balanceAccountId);
        payoutConfigurationResponse.setCurrencyCode(currencyCode);
        payoutConfigurationResponse.setInstant(instant);
        payoutConfigurationResponse.setRegular(regular);
        payoutConfigurationResponse.setSchedule(schedule);

        return payoutConfigurationResponse;
    }

    private String getAccountIdentifier(String transferInstrumentId) throws ApiException, IOException {
        String accountIdentifier = "";

        TransferInstrument  transferInstrument = transferInstrumentsApi.getTransferInstrument(transferInstrumentId);
        Object object = transferInstrument.getBankAccount().getAccountIdentification().getActualInstance();

        BankAccountInfoAccountIdentification bankAccountInfoAccountIdentification = transferInstrument.getBankAccount().getAccountIdentification();

        accountIdentifier = switch (object.getClass().getName()) {
            case "com.adyen.model.legalentitymanagement.IbanAccountIdentification" ->
                    bankAccountInfoAccountIdentification.getIbanAccountIdentification().getIban();
            case "com.adyen.model.legalentitymanagement.USLocalAccountIdentification" ->
                    bankAccountInfoAccountIdentification.getUSLocalAccountIdentification().getAccountNumber();
            case "com.adyen.model.legalentitymanagement.UKLocalAccountIdentification" ->
                    bankAccountInfoAccountIdentification.getUKLocalAccountIdentification().getAccountNumber();
            default -> accountIdentifier;
        };

        return accountIdentifier;
    }

    public List<PayoutConfigurationResponse> getPayoutConfiguration(User user) throws IOException, ApiException {
        List<PayoutConfigurationResponse> payoutConfigs = new ArrayList<>();


        List<String> balanceAccountIds = accountHoldersApi
                .getAllBalanceAccountsOfAccountHolder(user.getAccountHolderId())
                .getBalanceAccounts()
                .stream()
                .map(BalanceAccountBase::getId)
                .toList();

        for (String balanceAccountId : balanceAccountIds) {
            List<SweepConfigurationV2> sweeps = balanceAccountsApi
                    .getAllSweepsForBalanceAccount(balanceAccountId)
                    .getSweeps();

            if (sweeps != null) {
                for (SweepConfigurationV2 sweep : sweeps) {
                    PayoutConfigurationResponse response = getPayoutConfigurationResponse(balanceAccountId, sweep, user.getLegalEntityId());
                    payoutConfigs.add(response);
                }
            }
        }

        return payoutConfigs;
    }

    private PayoutConfigurationResponse getPayoutConfigurationResponse(String balanceAccountId, SweepConfigurationV2 sweep, String legalEntityId) throws IOException, ApiException {
        PayoutConfigurationResponse response = new PayoutConfigurationResponse();

        response.setBalanceAccountId(balanceAccountId);
        response.setCurrencyCode(sweep.getCurrency());
        response.setSchedule(
                sweep.getSchedule() != null ? sweep.getSchedule().getType().toString() : null
        );

        List<SweepConfigurationV2.PrioritiesEnum> prioritiesEnums = sweep.getPriorities();
        response.setInstant(false);
        response.setRegular(false);
        for (SweepConfigurationV2.PrioritiesEnum prioritiesEnum : prioritiesEnums) {
            if (prioritiesEnum.getValue().equals("instant")) {
                response.setInstant(true);
            }
            if (prioritiesEnum.getValue().equals("regular")) {
                response.setRegular(true);
            }
        }

        String accountIdentifier = getAccountIdentifier(sweep.getCounterparty().getTransferInstrumentId());
        response.setAccountIdentifier(accountIdentifier);
        return response;
    }
}
