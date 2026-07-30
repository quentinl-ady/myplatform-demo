package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.transfers.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.adyen.model.transfers.Address;
import com.adyen.model.transfers.IbanAccountIdentification;
import com.adyen.model.transfers.UKLocalAccountIdentification;
import com.adyen.model.transfers.USLocalAccountIdentification;
import com.adyen.service.balanceplatform.ManageScaDevicesApi;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.model.InitiateTransferResponse;
import com.myplatform.demo.model.PendingTransfer;
import com.myplatform.demo.model.TransferRequest;
import com.myplatform.demo.repository.PendingTransferRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.myplatform.demo.util.AdyenConstants.SEPA_COUNTRIES;

@Service
public class TransferService {

    private static final Logger log = LoggerFactory.getLogger(TransferService.class);

    private final ManageScaDevicesApi manageScaDevicesApi;
    private final String balancePlatformApiKey;
    private final RestTemplate restTemplate;
    private final PendingTransferRepository pendingTransferRepository;

    public TransferService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                           @Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                           RestTemplate restTemplate,
                           PendingTransferRepository pendingTransferRepository) {
        this.manageScaDevicesApi = new ManageScaDevicesApi(balancePlatformClient);
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.restTemplate = restTemplate;
        this.pendingTransferRepository = pendingTransferRepository;
    }

    public List<Device> getListDevices(String paymentInstrumentId) throws IOException, ApiException {
        SearchRegisteredDevicesResponse searchRegisteredDevicesResponse = manageScaDevicesApi.listRegisteredScaDevices(paymentInstrumentId);
        return searchRegisteredDevicesResponse.getData();
    }

    public RegisterSCAResponse registerDevice(String sdkOutput, String paymentInstrumentId, String deviceName) throws IOException, ApiException {
        DelegatedAuthenticationData delegatedAuthenticationData = new DelegatedAuthenticationData();
        delegatedAuthenticationData.setSdkOutput(sdkOutput);

        RegisterSCARequest registerSCARequest = new RegisterSCARequest()
                .name(deviceName != null && !deviceName.isBlank() ? deviceName : "My Device")
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

    public AssociationInitiateResponse initiateDeviceAssociation(String deviceId, List<String> paymentInstrumentIds) throws IOException, ApiException {
        AssociationInitiateRequest request = new AssociationInitiateRequest()
                .ids(paymentInstrumentIds)
                .type(AssociationInitiateRequest.TypeEnum.PAYMENTINSTRUMENT);
        return manageScaDevicesApi.initiateAssociationBetweenScaDeviceAndResource(deviceId, request);
    }

    public AssociationFinaliseResponse finalizeDeviceAssociation(String deviceId, List<String> paymentInstrumentIds, String sdkOutput) throws IOException, ApiException {
        AssociationDelegatedAuthenticationData authData = new AssociationDelegatedAuthenticationData();
        authData.setSdkOutput(sdkOutput);

        AssociationFinaliseRequest request = new AssociationFinaliseRequest()
                .ids(paymentInstrumentIds)
                .type(AssociationFinaliseRequest.TypeEnum.PAYMENTINSTRUMENT)
                .strongCustomerAuthentication(authData);
        return manageScaDevicesApi.completeAssociationBetweenScaDeviceAndResource(deviceId, request);
    }

    public void deleteDeviceAssociation(String deviceId, String paymentInstrumentId) {
        try {
            manageScaDevicesApi.deleteRegistrationOfScaDevice(deviceId, paymentInstrumentId);
            log.info("Deleted device {} association with virtual PI {}", deviceId, paymentInstrumentId);
        } catch (Exception e) {
            log.warn("Failed to delete device {} association with virtual PI {}: {}", deviceId, paymentInstrumentId, e.getMessage());
        }
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

    public Map<String, Object> initiateBatchTransfer(TransferRequest request, String paymentInstrumentId, String accountHolderId) {
        TransferInfo transferInfo = getTransferInfo(request, paymentInstrumentId);

        TransferRequestReview review = new TransferRequestReview()
                .numberOfApprovalsRequired(1)
                .scaOnApproval(true);
        transferInfo.setReview(review);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.add("X-API-Key", balancePlatformApiKey);

        HttpEntity<TransferInfo> entity = new HttpEntity<>(transferInfo, headers);

        String url = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";

        ResponseEntity<Transfer> response =
                restTemplate.exchange(url, HttpMethod.POST, entity, Transfer.class);

        Transfer transfer = response.getBody();

        Map<String, Object> result = new HashMap<>();
        result.put("id", transfer.getId());
        result.put("amount", transfer.getAmount().getValue());
        result.put("currency", transfer.getAmount().getCurrency());
        result.put("counterpartyName", request.getCounterpartyName());
        result.put("status", transfer.getStatus() != null ? transfer.getStatus().getValue() : "unknown");
        result.put("reason", transfer.getReason() != null ? transfer.getReason().getValue() : null);
        result.put("description", request.getDescription());
        result.put("reference", request.getReference());

        // Save pending transfer for persistence across page reloads
        PendingTransfer pt = new PendingTransfer();
        pt.setTransferId(transfer.getId());
        pt.setAccountHolderId(accountHolderId);
        pendingTransferRepository.save(pt);

        return result;
    }

    public Map<String, Object> approveTransfers(List<String> transferIds, String sdkOutput) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.add("X-API-Key", balancePlatformApiKey);

        String authenticate = "SCA realm=\"ApproveTransfers\" " + "auth-param1=\"" + sdkOutput + "\"";
        headers.add("WWW-Authenticate", authenticate);

        Map<String, Object> body = new HashMap<>();
        body.put("transferIds", transferIds);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        String url = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers/approve";

        int maxRetries = 3;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                restTemplate.exchange(url, HttpMethod.POST, entity, String.class);
                // Remove approved transfers from pending store
                pendingTransferRepository.deleteAllById(transferIds);
                Map<String, Object> result = new HashMap<>();
                result.put("status", "success");
                return result;
            } catch (org.springframework.web.client.HttpClientErrorException e) {
                String responseBody = e.getResponseBodyAsString();
                if (attempt < maxRetries && responseBody != null && responseBody.contains("Transfer not found")) {
                    log.info("Transfer not found on attempt {}/{}, retrying in 2s...", attempt, maxRetries);
                    try { Thread.sleep(2000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                } else {
                    throw e;
                }
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("status", "success");
        return result;
    }

    public Map<String, Object> getPendingTransfers(String accountHolderId) {
        List<PendingTransfer> stored = pendingTransferRepository.findByAccountHolderId(accountHolderId);
        List<Map<String, Object>> results = new java.util.ArrayList<>();
        int notFoundCount = 0;

        for (PendingTransfer pt : stored) {
            try {
                Map<String, Object> detail = fetchTransferDetail(pt.getTransferId());
                if (detail != null) {
                    results.add(detail);
                }
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                notFoundCount++;
                log.warn("Transfer {} not yet propagated (404)", pt.getTransferId());
            } catch (Exception e) {
                log.warn("Failed to fetch transfer detail for {}: {}", pt.getTransferId(), e.getMessage());
            }
        }

        Map<String, Object> response = new HashMap<>();
        response.put("transfers", results);
        response.put("notFoundCount", notFoundCount);
        response.put("totalCount", stored.size());
        return response;
    }

    private Map<String, Object> fetchTransferDetail(String transferId) {
        String url = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers/" + transferId;

        HttpHeaders headers = new HttpHeaders();
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        headers.set("x-api-key", balancePlatformApiKey);

        HttpEntity<Void> entity = new HttpEntity<>(headers);
        ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);

        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode t = mapper.readTree(response.getBody());

            Map<String, Object> item = new HashMap<>();
            item.put("id", t.get("id").asText());
            if (t.has("amount")) {
                item.put("amount", t.get("amount").get("value").asLong());
                item.put("currency", t.get("amount").get("currency").asText());
            }
            String counterpartyName = "";
            if (t.has("counterparty") && t.get("counterparty").has("bankAccount")
                    && t.get("counterparty").get("bankAccount").has("accountHolder")) {
                com.fasterxml.jackson.databind.JsonNode ah = t.get("counterparty").get("bankAccount").get("accountHolder");
                if (ah.has("fullName")) counterpartyName = ah.get("fullName").asText();
            }
            item.put("counterpartyName", counterpartyName);
            item.put("status", t.has("status") ? t.get("status").asText() : "");
            item.put("reason", t.has("reason") ? t.get("reason").asText() : "");
            item.put("description", t.has("description") ? t.get("description").asText() : "");
            item.put("reference", t.has("reference") ? t.get("reference").asText() : "");
            return item;
        } catch (Exception e) {
            log.error("Failed to parse transfer detail for {}: {}", transferId, e.getMessage());
            return null;
        }
    }

    private TransferInfo getTransferInfo(TransferRequest request, String paymentInstrumentId) {
        TransferInfo transferInfo = new TransferInfo();
        BankAccountV3AccountIdentification accountIdentification = new BankAccountV3AccountIdentification();
        Address address = new Address();

        if (SEPA_COUNTRIES.contains(request.getCounterpartyCountry())) {
            transferInfo.setAmount(new com.adyen.model.transfers.Amount().currency("EUR").value(request.getAmount()));
            IbanAccountIdentification iban = new IbanAccountIdentification();
            iban.setIban(request.getIban());
            iban.setType(IbanAccountIdentification.TypeEnum.IBAN);
            accountIdentification = new BankAccountV3AccountIdentification(iban);

            address.setCountry(request.getCounterpartyCountry());
        } else if ("US".equals(request.getCounterpartyCountry())) {
            transferInfo.setAmount(new com.adyen.model.transfers.Amount().currency("USD").value(request.getAmount()));
            USLocalAccountIdentification usLocalAccountIdentification = new USLocalAccountIdentification();
            usLocalAccountIdentification.setAccountNumber(request.getAccountNumber());
            usLocalAccountIdentification.setRoutingNumber(request.getRoutingNumber());
            usLocalAccountIdentification.setType(USLocalAccountIdentification.TypeEnum.USLOCAL);
            accountIdentification = new BankAccountV3AccountIdentification(usLocalAccountIdentification);

            address.setCountry(request.getCounterpartyCountry());
            address.setPostalCode("20001");
            address.setCity("Washington");
            address.setLine1("71 5th Avenue");
        } else if ("UK".equals(request.getCounterpartyCountry()) || "GB".equals(request.getCounterpartyCountry())) {
            transferInfo.setAmount(new com.adyen.model.transfers.Amount().currency("GBP").value(request.getAmount()));
            UKLocalAccountIdentification ukLocalAccountIdentification = new UKLocalAccountIdentification();
            ukLocalAccountIdentification.setAccountNumber(request.getAccountNumber());
            ukLocalAccountIdentification.setSortCode(request.getSortCode());
            ukLocalAccountIdentification.setType(UKLocalAccountIdentification.TypeEnum.UKLOCAL);
            accountIdentification = new BankAccountV3AccountIdentification(ukLocalAccountIdentification);

            address.setCountry("GB");
            address.setPostalCode("SW1A 1AA");
            address.setCity("London");
            address.setLine1("123 Main St");
        }

        transferInfo.setPaymentInstrumentId(paymentInstrumentId);
        transferInfo.setCategory(TransferInfo.CategoryEnum.BANK);
        CounterpartyInfoV3 counterpartyInfo = new CounterpartyInfoV3();
        BankAccountV3 bankAccount = new BankAccountV3();
        bankAccount.setAccountHolder(new PartyIdentification().fullName(request.getCounterpartyName())
                .address(address));
        bankAccount.setAccountIdentification(accountIdentification);
        counterpartyInfo.setBankAccount(bankAccount);
        transferInfo.setCounterparty(counterpartyInfo);
        transferInfo.setDescription(request.getDescription() != null ? request.getDescription() : request.getReference());
        transferInfo.setReference(request.getReference());
        transferInfo.setPriority(TransferInfo.PriorityEnum.fromValue(request.getTransferType()));
        return transferInfo;
    }
}
