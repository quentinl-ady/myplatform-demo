package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.enums.Environment;
import com.adyen.model.balanceplatform.AccountHolder;
import com.adyen.model.balanceplatform.AccountHolderInfo;
import com.adyen.model.balanceplatform.BalanceAccount;
import com.adyen.model.balanceplatform.BalanceAccountInfo;
import com.adyen.model.legalentitymanagement.*;
import com.adyen.service.balanceplatform.AccountHoldersApi;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.HostedOnboardingApi;
import com.adyen.service.legalentitymanagement.LegalEntitiesApi;
import com.myplatform.demo.model.KycStatus;
import com.myplatform.demo.model.Status;
import com.myplatform.demo.model.User;
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
import java.util.Map;

@Service
public class AdyenService {
    private final LegalEntitiesApi lem;
    private final HostedOnboardingApi hop;
    private final AccountHoldersApi accountHoldersApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final String balancePlatformApiKey;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    Map<String, String> languageMap = Map.of(
            "FR", "fr-FR",
            "DE", "de-DE",
            "NL", "nl-NL",
            "GB", "en-EN",
            "US","en-US"
    );


    public AdyenService(@Value("${adyen.lemApiKey}") String apiKey) {
        Client client = new Client(apiKey, Environment.TEST);
        lem = new LegalEntitiesApi(client);
        hop = new HostedOnboardingApi(client);
        accountHoldersApi = new AccountHoldersApi(client);
        balanceAccountsApi = new BalanceAccountsApi(client);
        balancePlatformApiKey = apiKey;
        httpClient = HttpClient.newHttpClient();
        objectMapper = new ObjectMapper();
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


    public String createAccountHolder(String legalEntityId) throws IOException, ApiException {
        AccountHolderInfo accountHolderInfo = new AccountHolderInfo()
                .legalEntityId(legalEntityId)
                        .reference(String.valueOf(System.currentTimeMillis()));
        AccountHolder accountHolder = accountHoldersApi.createAccountHolder(accountHolderInfo);
        return accountHolder.getId();
    }

    public KycStatus getLegalEntityKycDetail(String legalEntityId) throws IOException, ApiException {
        KycStatus kycStatus = new KycStatus();
        Status acquiring = new Status();
        Status payout = new Status();

        LegalEntity legalEntity = lem.getLegalEntity(legalEntityId);
        Map<String, LegalEntityCapability> map = legalEntity.getCapabilities();

        LegalEntityCapability receivePayment = map.get("receivePayments");
        LegalEntityCapability sendToTransferInstrument = map.get("sendToTransferInstrument");

        acquiring.setAllowed(receivePayment.getAllowed());
        acquiring.setVerificationStatus(receivePayment.getVerificationStatus());

        payout.setAllowed(sendToTransferInstrument.getAllowed());
        payout.setVerificationStatus(sendToTransferInstrument.getVerificationStatus());

        kycStatus.setAcquiringStatus(acquiring);
        kycStatus.setPayoutStatus(payout);

        return kycStatus;
    }

    public String createBalanceAccountId(String accountHolderId, String currencyCode) throws IOException, ApiException {
        BalanceAccountInfo balanceAccountInfo = new BalanceAccountInfo()
                .accountHolderId(accountHolderId)
                .defaultCurrencyCode(currencyCode);

        BalanceAccount balanceAccount = balanceAccountsApi.createBalanceAccount(balanceAccountInfo);
        return balanceAccount.getId();
    }


    public String createSession(String accountHolderId, String[] v2) throws Exception {
        Map<String, Object> requestBody = Map.of(
                "allowOrigin", "http://localhost",
                "product", "platform",
                "policy", Map.of(
                        "resources", new Map[]{ Map.of(
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
}
