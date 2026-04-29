package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.service.balanceplatform.BankAccountValidationApi;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.dto.AdyenVerifyRequestPayload;
import com.myplatform.demo.dto.AdyenVerifyResponseWrapper;
import com.myplatform.demo.model.CounterpartyVerificationResponse;
import com.myplatform.demo.model.IsBankAccountValidRequest;
import com.myplatform.demo.model.VerifyCounterpartyNameRequest;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;

import static com.myplatform.demo.util.AdyenConstants.SEPA_COUNTRIES;

@Service
public class BankValidationService {

    private final BankAccountValidationApi bankAccountValidationApi;
    private final String balancePlatformApiKey;
    private final RestTemplate restTemplate;

    public BankValidationService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                                 @Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                                 RestTemplate restTemplate) {
        this.bankAccountValidationApi = new BankAccountValidationApi(balancePlatformClient);
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.restTemplate = restTemplate;
    }

    public String getBankAccountFormat(String countryCode) {
        if (countryCode == null || countryCode.isBlank()) {
            return "unknown";
        }

        String normalizedCode = countryCode.trim().toUpperCase();

        return switch (normalizedCode) {
            case "US" -> "accountNumberRoutingNumber";
            case "GB", "UK" -> "accountNumberSortCode";
            default -> SEPA_COUNTRIES.contains(normalizedCode) ? "iban" : "unknown";
        };
    }

    public Boolean isCrossBorder(String countryCodeCounterparty, String countryCodeBankAccount) {
        if (countryCodeCounterparty == null || countryCodeCounterparty.isBlank() ||
                countryCodeBankAccount == null || countryCodeBankAccount.isBlank()) {
            throw new IllegalArgumentException("Missing Argument");
        }

        String origin = countryCodeCounterparty.trim().toUpperCase();
        String destination = countryCodeBankAccount.trim().toUpperCase();

        if (origin.equals(destination)) {
            return false;
        }

        return !SEPA_COUNTRIES.contains(origin) || !SEPA_COUNTRIES.contains(destination);
    }

    public void isBankAccountValid(IsBankAccountValidRequest request) throws IOException, ApiException {
        BankAccountIdentificationValidationRequest bankAccountIdentificationValidationRequest = new BankAccountIdentificationValidationRequest();
        BankAccountIdentificationValidationRequestAccountIdentification bankAccountIdentificationValidationRequestAccountIdentification = new BankAccountIdentificationValidationRequestAccountIdentification();

        if ("accountNumberRoutingNumber".equals(request.getBankAccountFormat())) {
            USLocalAccountIdentification usLocalAccountIdentification = new USLocalAccountIdentification();
            usLocalAccountIdentification.setAccountNumber(request.getAccountNumber());
            usLocalAccountIdentification.setRoutingNumber(request.getRoutingNumber());
            usLocalAccountIdentification.setType(USLocalAccountIdentification.TypeEnum.USLOCAL);
            bankAccountIdentificationValidationRequestAccountIdentification = new BankAccountIdentificationValidationRequestAccountIdentification(usLocalAccountIdentification);

        } else if ("accountNumberSortCode".equals(request.getBankAccountFormat())) {
            UKLocalAccountIdentification ukLocalAccountIdentification = new UKLocalAccountIdentification();
            ukLocalAccountIdentification.setAccountNumber(request.getAccountNumber());
            ukLocalAccountIdentification.setSortCode(request.getSortCode());
            ukLocalAccountIdentification.setType(UKLocalAccountIdentification.TypeEnum.UKLOCAL);
            bankAccountIdentificationValidationRequestAccountIdentification = new BankAccountIdentificationValidationRequestAccountIdentification(ukLocalAccountIdentification);

        } else if ("iban".equals(request.getBankAccountFormat())) {
            IbanAccountIdentification iban = new IbanAccountIdentification();
            iban.setIban(request.getIban());
            iban.setType(IbanAccountIdentification.TypeEnum.IBAN);
            bankAccountIdentificationValidationRequestAccountIdentification = new BankAccountIdentificationValidationRequestAccountIdentification(iban);
        }

        bankAccountIdentificationValidationRequest.setAccountIdentification(bankAccountIdentificationValidationRequestAccountIdentification);
        bankAccountValidationApi.validateBankAccountIdentification(bankAccountIdentificationValidationRequest);
    }

    public CounterpartyVerificationResponse verifyCounterpartyName(VerifyCounterpartyNameRequest request) {
        AdyenVerifyRequestPayload payload = getAdyenVerifyRequestPayload(request);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-api-key", balancePlatformApiKey);

        HttpEntity<AdyenVerifyRequestPayload> entity = new HttpEntity<>(payload, headers);

        ResponseEntity<AdyenVerifyResponseWrapper> response = restTemplate.exchange(
                "https://balanceplatform-api-test.adyen.com/bcl/v2/verifyCounterpartyName",
                HttpMethod.POST,
                entity,
                AdyenVerifyResponseWrapper.class
        );

        if (response.getBody() != null) {
            return response.getBody().getCounterpartyVerification();
        }

        return null;
    }

    private AdyenVerifyRequestPayload getAdyenVerifyRequestPayload(VerifyCounterpartyNameRequest request) {
        AdyenVerifyRequestPayload.AccountHolder accountHolder =
                new AdyenVerifyRequestPayload.AccountHolder(request.getAccountHolderName());

        AdyenVerifyRequestPayload.AccountIdentification accountIdentification =
                new AdyenVerifyRequestPayload.AccountIdentification();

        if ("iban".equalsIgnoreCase(request.getAccountType())) {
            accountIdentification.setType("iban");
            accountIdentification.setIban(request.getIban());
        } else if ("accountNumberSortCode".equalsIgnoreCase(request.getAccountType())) {
            accountIdentification.setType("ukLocal");
            accountIdentification.setAccountNumber(request.getAccountNumber());
            accountIdentification.setSortCode(request.getSortCode());
            accountIdentification.setAccountType("business");
        }

        AdyenVerifyRequestPayload.BankAccount bankAccount = new AdyenVerifyRequestPayload.BankAccount();
        bankAccount.setAccountHolder(accountHolder);
        bankAccount.setAccountIdentification(accountIdentification);

        AdyenVerifyRequestPayload.Counterparty counterparty = new AdyenVerifyRequestPayload.Counterparty();
        counterparty.setBankAccount(bankAccount);

        AdyenVerifyRequestPayload payload = new AdyenVerifyRequestPayload();
        payload.setCounterparty(counterparty);
        payload.setReference(request.getReference());

        return payload;
    }
}
