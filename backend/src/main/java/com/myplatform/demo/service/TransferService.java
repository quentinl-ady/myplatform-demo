package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.transfers.*;
import com.adyen.model.transfers.IbanAccountIdentification;
import com.adyen.model.transfers.UKLocalAccountIdentification;
import com.adyen.model.transfers.USLocalAccountIdentification;
import com.adyen.service.balanceplatform.ManageScaDevicesApi;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.model.InitiateTransferResponse;
import com.myplatform.demo.model.TransferRequest;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.List;

import static com.myplatform.demo.util.AdyenConstants.SEPA_COUNTRIES;

@Service
public class TransferService {

    private final ManageScaDevicesApi manageScaDevicesApi;
    private final String balancePlatformApiKey;
    private final RestTemplate restTemplate;

    public TransferService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                           @Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                           RestTemplate restTemplate) {
        this.manageScaDevicesApi = new ManageScaDevicesApi(balancePlatformClient);
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.restTemplate = restTemplate;
    }

    public List<Device> getListDevices(String paymentInstrumentId) throws IOException, ApiException {
        SearchRegisteredDevicesResponse searchRegisteredDevicesResponse = manageScaDevicesApi.listRegisteredScaDevices(paymentInstrumentId);
        return searchRegisteredDevicesResponse.getData();
    }

    public RegisterSCAResponse registerDevice(String sdkOutput, String paymentInstrumentId) throws IOException, ApiException {
        DelegatedAuthenticationData delegatedAuthenticationData = new DelegatedAuthenticationData();
        delegatedAuthenticationData.setSdkOutput(sdkOutput);

        RegisterSCARequest registerSCARequest = new RegisterSCARequest()
                .name("macbook adyen")
                .paymentInstrumentId(paymentInstrumentId)
                .strongCustomerAuthentication(delegatedAuthenticationData);

        return manageScaDevicesApi.initiateRegistrationOfScaDevice(registerSCARequest);
    }

    public RegisterSCAFinalResponse finalizeRegistration(String id, String sdkOutput, String paymentInstrumentId) throws IOException, ApiException {
        DelegatedAuthenticationData delegatedAuthenticationData = new DelegatedAuthenticationData();
        delegatedAuthenticationData.setSdkOutput(sdkOutput);

        RegisterSCARequest registerSCARequest = new RegisterSCARequest()
                .paymentInstrumentId(paymentInstrumentId)
                .strongCustomerAuthentication(delegatedAuthenticationData);

        return manageScaDevicesApi.completeRegistrationOfScaDevice(id, registerSCARequest);
    }

    public void deleteDevice(String id, String paymentInstrumentId) throws IOException, ApiException {
        manageScaDevicesApi.deleteRegistrationOfScaDevice(id, paymentInstrumentId);
    }

    public InitiateTransferResponse initiateTransfer(TransferRequest request, String paymentInstrumentId) {
        TransferInfo transferInfo = getTransferInfo(request, paymentInstrumentId);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.add("X-API-Key", balancePlatformApiKey);

        String authenticate = "SCA realm=\"Transfer\" " + "auth-param1=\"" + request.getSdkOutput() + "\"";
        headers.add("WWW-Authenticate", authenticate);

        HttpEntity<TransferInfo> entity = new HttpEntity<>(transferInfo, headers);

        String url = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";

        ResponseEntity<Transfer> response =
                restTemplate.exchange(url, HttpMethod.POST, entity, Transfer.class);

        Transfer transferBody = response.getBody();
        HttpHeaders transferHeaders = response.getHeaders();

        InitiateTransferResponse initiateTransferResponse = new InitiateTransferResponse();
        initiateTransferResponse.setAmount(transferBody.getAmount().getValue());
        initiateTransferResponse.setCounterpartyCountry(request.getCounterpartyCountry());
        populateCounterpartyDetails(initiateTransferResponse, request);

        List<String> authParam1Values = transferHeaders.get("auth-param1");
        if (authParam1Values != null && !authParam1Values.isEmpty()) {
            initiateTransferResponse.setAuthParam1(authParam1Values.get(0));
        }

        return initiateTransferResponse;
    }

    public void finalizeTransfer(TransferRequest request, String paymentInstrumentId) {
        TransferInfo transferInfo = getTransferInfo(request, paymentInstrumentId);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.add("X-API-Key", balancePlatformApiKey);

        String authenticate = "SCA realm=\"Transfer\" " + "auth-param1=\"" + request.getSdkOutput() + "\"";
        headers.add("WWW-Authenticate", authenticate);

        HttpEntity<TransferInfo> entity = new HttpEntity<>(transferInfo, headers);

        String url = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";

        restTemplate.exchange(url, HttpMethod.POST, entity, Transfer.class);
    }

    public void populateCounterpartyDetails(InitiateTransferResponse response, TransferRequest request) {
        if (SEPA_COUNTRIES.contains(request.getCounterpartyCountry())) {
            response.setIban(request.getIban());
        } else if ("US".equals(request.getCounterpartyCountry())) {
            response.setAccountNumber(request.getAccountNumber());
            response.setRoutingNumber(request.getRoutingNumber());
        } else if ("UK".equals(request.getCounterpartyCountry()) || "GB".equals(request.getCounterpartyCountry())) {
            response.setAccountNumber(request.getAccountNumber());
            response.setSortCode(request.getSortCode());
        }
    }

    private TransferInfo getTransferInfo(TransferRequest request, String paymentInstrumentId) {
        TransferInfo transferInfo = new TransferInfo();
        BankAccountV3AccountIdentification accountIdentification = new BankAccountV3AccountIdentification();

        if (SEPA_COUNTRIES.contains(request.getCounterpartyCountry())) {
            transferInfo.setAmount(new com.adyen.model.transfers.Amount().currency("EUR").value(request.getAmount()));
            IbanAccountIdentification iban = new IbanAccountIdentification();
            iban.setIban(request.getIban());
            iban.setType(IbanAccountIdentification.TypeEnum.IBAN);
            accountIdentification = new BankAccountV3AccountIdentification(iban);
        } else if ("US".equals(request.getCounterpartyCountry())) {
            transferInfo.setAmount(new com.adyen.model.transfers.Amount().currency("USD").value(request.getAmount()));
            USLocalAccountIdentification usLocalAccountIdentification = new USLocalAccountIdentification();
            usLocalAccountIdentification.accountNumber(request.getAccountNumber());
            usLocalAccountIdentification.routingNumber(request.getRoutingNumber());
            accountIdentification = new BankAccountV3AccountIdentification(usLocalAccountIdentification);
        } else if ("UK".equals(request.getCounterpartyCountry()) || "GB".equals(request.getCounterpartyCountry())) {
            transferInfo.setAmount(new com.adyen.model.transfers.Amount().currency("GBP").value(request.getAmount()));
            UKLocalAccountIdentification ukLocalAccountIdentification = new UKLocalAccountIdentification();
            ukLocalAccountIdentification.accountNumber(request.getAccountNumber());
            ukLocalAccountIdentification.setSortCode(request.getSortCode());
            accountIdentification = new BankAccountV3AccountIdentification(ukLocalAccountIdentification);
        }

        transferInfo.setPaymentInstrumentId(paymentInstrumentId);
        transferInfo.setCategory(TransferInfo.CategoryEnum.BANK);
        CounterpartyInfoV3 counterpartyInfo = new CounterpartyInfoV3();
        BankAccountV3 bankAccount = new BankAccountV3();
        bankAccount.setAccountHolder(new PartyIdentification().fullName("Quentin Lecornu"));
        bankAccount.setAccountIdentification(accountIdentification);
        counterpartyInfo.setBankAccount(bankAccount);
        transferInfo.setCounterparty(counterpartyInfo);
        transferInfo.setDescription(request.getReference());
        transferInfo.setReference(request.getReference());
        transferInfo.setReferenceForBeneficiary(request.getReference());
        transferInfo.setPriority(TransferInfo.PriorityEnum.fromValue(request.getTransferType()));
        return transferInfo;
    }
}
