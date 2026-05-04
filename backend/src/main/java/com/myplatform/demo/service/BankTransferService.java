package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.BankTransferDTO;
import com.myplatform.demo.dto.TransactionDTO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class BankTransferService {

    private static final Logger log = LoggerFactory.getLogger(BankTransferService.class);

    private final String apiKey;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final String TRANSACTIONS_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/transactions";
    private static final String TRANSFERS_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";

    public BankTransferService(@Value("${adyen.balancePlatformApiKey}") String apiKey, RestTemplate restTemplate) {
        this.apiKey = apiKey;
        this.restTemplate = restTemplate;
    }

    // ---- SCA flow: initiate (step 1) ----

    public Map<String, Object> initiateBankTransfers(String accountHolderId, String paymentInstrumentId, String sdkOutput) {
        OffsetDateTime now = OffsetDateTime.now();
        String createdSince = now.minusDays(90).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
        String createdUntil = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);

        try {
            List<TransactionDTO> transactions = fetchTransactions(accountHolderId, paymentInstrumentId, sdkOutput, createdSince, createdUntil);
            return Map.of(
                    "status", "completed",
                    "transactions", transactions
            );
        } catch (HttpClientErrorException.Unauthorized ex) {
            String authParam1 = extractAuthParam1FromResponse(ex);

            Map<String, Object> result = new HashMap<>();
            result.put("status", "sca_required");
            result.put("authParam1", authParam1 != null ? authParam1 : "");
            result.put("createdSince", createdSince);
            result.put("createdUntil", createdUntil);
            return result;
        } catch (HttpClientErrorException ex) {
            throw ex;
        }
    }

    // ---- SCA flow: finalize (step 2) ----

    public Map<String, Object> finalizeBankTransfers(String accountHolderId, String paymentInstrumentId, String sdkOutput,
                                                      String createdSince, String createdUntil) {
        try {
            List<TransactionDTO> transactions = fetchTransactions(accountHolderId, paymentInstrumentId, sdkOutput, createdSince, createdUntil);
            return Map.of(
                    "status", "completed",
                    "transactions", transactions
            );
        } catch (HttpClientErrorException ex) {
            throw ex;
        }
    }

    // ---- Internal ----

    private List<TransactionDTO> fetchTransactions(String accountHolderId, String paymentInstrumentId, String sdkOutput,
                                                    String createdSince, String createdUntil) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(TRANSACTIONS_URL)
                .queryParam("accountHolderId", accountHolderId)
                .queryParam("createdSince", createdSince)
                .queryParam("createdUntil", createdUntil)
                .queryParam("limit", 50)
                .queryParam("sortOrder", "desc");

        if (paymentInstrumentId != null && !paymentInstrumentId.isBlank()) {
            builder.queryParam("paymentInstrumentId", paymentInstrumentId);
        }

        HttpHeaders headers = buildHeaders(sdkOutput);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        String url = builder.toUriString();

        ResponseEntity<String> response = restTemplate.exchange(
                url,
                HttpMethod.GET,
                entity,
                String.class
        );

        return parseTransactions(response.getBody());
    }

    private List<TransactionDTO> parseTransactions(String json) {
        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode data = root.get("data");
            if (data == null || !data.isArray()) {
                return List.of();
            }

            List<TransactionDTO> transactions = new ArrayList<>();
            for (JsonNode node : data) {
                transactions.add(mapTransaction(node));
            }

            return transactions;
        } catch (Exception e) {
            log.error("[Transactions] Failed to parse JSON: {}", e.getMessage());
            return List.of();
        }
    }

    private TransactionDTO mapTransaction(JsonNode node) {
        TransactionDTO dto = new TransactionDTO();
        dto.setId(getText(node, "id"));
        dto.setStatus(getText(node, "status"));
        dto.setDescription(getText(node, "description"));
        dto.setCreationDate(getText(node, "creationDate"));
        dto.setBookingDate(getText(node, "bookingDate"));
        dto.setValueDate(getText(node, "valueDate"));
        dto.setReferenceForBeneficiary(getText(node, "referenceForBeneficiary"));

        // Amount
        JsonNode amount = node.get("amount");
        if (amount != null) {
            dto.setAmount(amount.has("value") ? amount.get("value").asLong() : 0);
            dto.setCurrency(getText(amount, "currency"));
        }

        // Account holder
        JsonNode accountHolder = node.get("accountHolder");
        if (accountHolder != null) {
            dto.setAccountHolderId(getText(accountHolder, "id"));
            dto.setAccountHolderDescription(getText(accountHolder, "description"));
        }

        // Balance account
        JsonNode balanceAccount = node.get("balanceAccount");
        if (balanceAccount != null) {
            dto.setBalanceAccountId(getText(balanceAccount, "id"));
            dto.setBalanceAccountDescription(getText(balanceAccount, "description"));
        }

        // Payment instrument
        JsonNode pi = node.get("paymentInstrument");
        if (pi != null) {
            dto.setPaymentInstrumentId(getText(pi, "id"));
            dto.setPaymentInstrumentDescription(getText(pi, "description"));
        }

        // Transfer info
        JsonNode transfer = node.get("transfer");
        if (transfer != null) {
            dto.setTransferId(getText(transfer, "id"));
            dto.setTransferReference(getText(transfer, "reference"));
        }

        return dto;
    }

    // ---- Transfer detail (GET /transfers/{id}) ----

    public BankTransferDTO getTransferDetail(String transferId) {
        String url = TRANSFERS_URL + "/" + transferId;

        HttpHeaders headers = new HttpHeaders();
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        headers.set("x-api-key", apiKey);

        ResponseEntity<String> response = restTemplate.exchange(
                url, HttpMethod.GET, new HttpEntity<>(headers), String.class);

        try {
            JsonNode node = objectMapper.readTree(response.getBody());
            return mapTransferDetail(node);
        } catch (Exception e) {
            log.error("[TransferDetail] Failed to parse: {}", e.getMessage());
            throw new RuntimeException("Failed to parse transfer detail", e);
        }
    }

    private BankTransferDTO mapTransferDetail(JsonNode node) {
        BankTransferDTO dto = new BankTransferDTO();
        dto.setId(getText(node, "id"));
        dto.setStatus(getText(node, "status"));
        dto.setType(getText(node, "type"));
        dto.setReason(getText(node, "reason"));
        dto.setReference(getText(node, "reference"));
        dto.setDescription(getText(node, "description"));
        dto.setCreatedAt(getText(node, "createdAt"));
        dto.setUpdatedAt(getText(node, "updatedAt"));
        dto.setCategory(getText(node, "category"));
        dto.setDirection(getText(node, "direction"));
        dto.setSequenceNumber(node.has("sequenceNumber") ? node.get("sequenceNumber").asInt() : 0);

        // Amount
        JsonNode amount = node.get("amount");
        if (amount != null) {
            dto.setAmount(amount.has("value") ? amount.get("value").asLong() : 0);
            dto.setCurrency(getText(amount, "currency"));
        }

        // Payment instrument
        JsonNode pi = node.get("paymentInstrument");
        if (pi != null) {
            dto.setPaymentInstrumentId(getText(pi, "id"));
            dto.setPaymentInstrumentDescription(getText(pi, "description"));
        }

        // Category data
        JsonNode categoryData = node.get("categoryData");
        if (categoryData != null) {
            dto.setPriority(getText(categoryData, "priority"));
            dto.setPaymentType(getText(categoryData, "type"));
        }

        // Counterparty
        JsonNode counterparty = node.get("counterparty");
        if (counterparty != null) {
            String fullName = getText(counterparty, "fullName");

            JsonNode bankAccount = counterparty.get("bankAccount");
            if (bankAccount != null) {
                JsonNode accountHolder = bankAccount.get("accountHolder");
                if (accountHolder != null) {
                    String holderName = getText(accountHolder, "fullName");
                    if (holderName != null) fullName = holderName;
                }
                JsonNode accountIdentification = bankAccount.get("accountIdentification");
                if (accountIdentification != null) {
                    parseAccountIdentification(dto, accountIdentification);
                }
            }
            dto.setCounterpartyName(fullName);
        }

        // Events (lifecycle)
        JsonNode events = node.get("events");
        if (events != null && events.isArray()) {
            List<BankTransferDTO.TransferEvent> eventList = new ArrayList<>();
            for (JsonNode event : events) {
                BankTransferDTO.TransferEvent te = new BankTransferDTO.TransferEvent();
                te.setId(getText(event, "id"));
                te.setStatus(getText(event, "status"));
                te.setBookingDate(getText(event, "bookingDate"));
                te.setType(getText(event, "type"));

                JsonNode eventAmount = event.get("amount");
                if (eventAmount != null) {
                    te.setAmountValue(eventAmount.has("value") ? eventAmount.get("value").asLong() : 0);
                    te.setAmountCurrency(getText(eventAmount, "currency"));
                }
                JsonNode origAmount = event.get("originalAmount");
                if (origAmount != null) {
                    te.setOriginalAmountValue(origAmount.has("value") ? origAmount.get("value").asLong() : 0);
                    te.setOriginalAmountCurrency(getText(origAmount, "currency"));
                }
                eventList.add(te);
            }
            dto.setEvents(eventList);
        }

        return dto;
    }

    private void parseAccountIdentification(BankTransferDTO dto, JsonNode accountIdentification) {
        String type = getText(accountIdentification, "type");
        dto.setCounterpartyAccountIdentificationType(type);
        if (type == null) return;

        switch (type) {
            case "iban" -> dto.setCounterpartyIban(getText(accountIdentification, "iban"));
            case "ukLocal" -> {
                dto.setCounterpartyAccountNumber(getText(accountIdentification, "accountNumber"));
                dto.setCounterpartySortCode(getText(accountIdentification, "sortCode"));
            }
            case "usLocal" -> {
                dto.setCounterpartyAccountNumber(getText(accountIdentification, "accountNumber"));
                dto.setCounterpartyRoutingNumber(getText(accountIdentification, "routingNumber"));
            }
            case "numberAndBic" -> {
                dto.setCounterpartyAccountNumber(getText(accountIdentification, "accountNumber"));
                dto.setCounterpartyBankName(getText(accountIdentification, "bic"));
            }
            default -> {
                String iban = getText(accountIdentification, "iban");
                if (iban != null) dto.setCounterpartyIban(iban);
                String accountNumber = getText(accountIdentification, "accountNumber");
                if (accountNumber != null) dto.setCounterpartyAccountNumber(accountNumber);
            }
        }
    }

    // ---- Helpers ----

    private HttpHeaders buildHeaders(String sdkOutput) {
        HttpHeaders headers = new HttpHeaders();
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        headers.set("x-api-key", apiKey);

        if (sdkOutput != null && !sdkOutput.isBlank()) {
            headers.set("WWW-Authenticate", "SCA realm=\"Transaction\" auth-param1=\"" + sdkOutput + "\"");
        }

        return headers;
    }

    private String extractAuthParam1FromResponse(HttpClientErrorException.Unauthorized ex) {
        if (ex.getResponseHeaders() == null) return null;

        // Try dedicated auth-param1 header first
        String authParam1Header = ex.getResponseHeaders().getFirst("auth-param1");
        if (authParam1Header != null && !authParam1Header.isBlank()) {
            return authParam1Header;
        }

        // Fallback: parse from WWW-Authenticate header
        String wwwAuth = ex.getResponseHeaders().getFirst("WWW-Authenticate");
        return extractAuthParam1(wwwAuth);
    }

    private String extractAuthParam1(String wwwAuthHeader) {
        if (wwwAuthHeader == null) return null;
        String marker = "auth-param1=\"";
        int start = wwwAuthHeader.indexOf(marker);
        if (start < 0) return null;
        start += marker.length();
        int end = wwwAuthHeader.indexOf("\"", start);
        if (end < 0) return null;
        return wwwAuthHeader.substring(start, end);
    }

    private String getText(JsonNode node, String field) {
        return node.has(field) && !node.get(field).isNull() ? node.get(field).asText() : null;
    }
}
