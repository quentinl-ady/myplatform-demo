package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.BalanceAccount;
import com.adyen.model.balanceplatform.TransferRouteRequest;
import com.adyen.model.balanceplatform.TransferRouteResponse;
import com.adyen.model.balanceplatform.TransferRoute;
import com.adyen.model.transfers.*;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.balanceplatform.TransferRoutesApi;
import com.myplatform.demo.exception.BadRequestException;
import com.adyen.service.exception.ApiException;
import com.adyen.service.transfers.TransfersApi;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class CashManagementService {

    private final TransfersApi transfersApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final TransferRoutesApi transferRoutesApi;
    private final String balancePlatformApiKey;
    private final String balancePlatform;
    private final RestTemplate restTemplate;

    private static final String CASHOUT_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/cashouts";

    public CashManagementService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                                  @Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                                  @Value("${adyen.balancePlatform}") String balancePlatform,
                                  RestTemplate restTemplate) {
        this.transfersApi = new TransfersApi(balancePlatformClient);
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        this.transferRoutesApi = new TransferRoutesApi(balancePlatformClient);
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.balancePlatform = balancePlatform;
        this.restTemplate = restTemplate;
    }

    public Map<String, Object> executeInternalTransfer(String sourceBalanceAccountId,
                                                        String destinationBalanceAccountId,
                                                        String currency,
                                                        long amount,
                                                        String description) throws IOException, ApiException {

        BalanceAccount sourceAccount = balanceAccountsApi.getBalanceAccount(sourceBalanceAccountId);
        BalanceAccount destAccount = balanceAccountsApi.getBalanceAccount(destinationBalanceAccountId);
        boolean isSourceBBA = "Business Bank Account".equals(sourceAccount.getDescription());
        boolean isDestBBA = "Business Bank Account".equals(destAccount.getDescription());

        if (isSourceBBA && !currency.equals(sourceAccount.getDefaultCurrencyCode())) {
            throw new BadRequestException("Transfers from a Business Bank Account must use its currency: " + sourceAccount.getDefaultCurrencyCode());
        }
        if (isDestBBA && !currency.equals(destAccount.getDefaultCurrencyCode())) {
            throw new BadRequestException("Transfers to a Business Bank Account must use its currency: " + destAccount.getDefaultCurrencyCode());
        }

        TransferInfo transferInfo = new TransferInfo();
        transferInfo.setAmount(new Amount().currency(currency).value(amount));
        transferInfo.setCategory(TransferInfo.CategoryEnum.INTERNAL);

        if (isSourceBBA) {
            transferInfo.setType(TransferInfo.TypeEnum.INTERNALDIRECTDEBIT);
            transferInfo.setBalanceAccountId(destinationBalanceAccountId);
            CounterpartyInfoV3 counterparty = new CounterpartyInfoV3();
            counterparty.setBalanceAccountId(sourceBalanceAccountId);
            transferInfo.setCounterparty(counterparty);
        } else {
            transferInfo.setBalanceAccountId(sourceBalanceAccountId);
            CounterpartyInfoV3 counterparty = new CounterpartyInfoV3();
            counterparty.setBalanceAccountId(destinationBalanceAccountId);
            transferInfo.setCounterparty(counterparty);
        }

        if (description != null && !description.isBlank()) {
            transferInfo.setDescription(description);
        }

        Transfer transfer = transfersApi.transferFunds(transferInfo);

        Map<String, Object> result = new HashMap<>();
        if (transfer != null) {
            result.put("id", transfer.getId());
            result.put("status", transfer.getStatus() != null ? transfer.getStatus().getValue() : null);
            result.put("reason", transfer.getReason() != null ? transfer.getReason().getValue() : null);
        }
        return result;
    }

    public Map<String, Object> executeCashout(String balanceAccountId,
                                               String currency,
                                               long amount,
                                               String transferInstrumentId,
                                               String description) {
        long fee = Math.round(amount * 0.05);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("instructingBalanceAccountId", balanceAccountId);

        Map<String, Object> amountObj = new HashMap<>();
        amountObj.put("currency", currency);
        amountObj.put("value", amount);
        requestBody.put("amount", amountObj);

        Map<String, Object> feeAmount = new HashMap<>();
        feeAmount.put("currency", currency);
        feeAmount.put("value", fee);
        Map<String, Object> feeObj = new HashMap<>();
        feeObj.put("amount", feeAmount);
        requestBody.put("fee", feeObj);

        if (transferInstrumentId != null && !transferInstrumentId.isBlank()) {
            Map<String, Object> counterparty = new HashMap<>();
            counterparty.put("transferInstrumentId", transferInstrumentId);
            requestBody.put("counterparty", counterparty);
        }

        if (description != null && !description.isBlank()) {
            requestBody.put("description", description);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.add("X-API-Key", balancePlatformApiKey);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
        ResponseEntity<Map> response = restTemplate.exchange(
                CASHOUT_URL, HttpMethod.POST, entity, Map.class);

        Map<String, Object> result = new HashMap<>();
        Map body = response.getBody();
        if (body != null) {
            result.put("id", body.get("id"));
            result.put("status", "created");
        }
        result.put("fee", fee);
        result.put("amount", amount);
        return result;
    }

    public Map<String, Object> checkInstantEligibility(String balanceAccountId,
                                                        String transferInstrumentId,
                                                        String currency) throws IOException, ApiException {
        TransferRouteRequest request = new TransferRouteRequest()
                .balancePlatform(balancePlatform)
                .balanceAccountId(balanceAccountId)
                .category(TransferRouteRequest.CategoryEnum.BANK)
                .counterparty(new com.adyen.model.balanceplatform.Counterparty().transferInstrumentId(transferInstrumentId))
                .currency(currency)
                .priorities(List.of(TransferRouteRequest.PrioritiesEnum.INSTANT));

        TransferRouteResponse response;
        try {
            response = transferRoutesApi.calculateTransferRoutes(request);
        } catch (ApiException e) {
            System.err.println("TransferRoutes API error: " + e.getResponseBody());
            throw e;
        }

        boolean instantAvailable = false;
        if (response.getTransferRoutes() != null) {
            instantAvailable = response.getTransferRoutes().stream()
                    .anyMatch(route -> TransferRoute.PriorityEnum.INSTANT.equals(route.getPriority()));
        }

        Map<String, Object> result = new HashMap<>();
        result.put("instantAvailable", instantAvailable);
        return result;
    }
}
