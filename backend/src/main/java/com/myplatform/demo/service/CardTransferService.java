package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.CardTransferDTO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class CardTransferService {

    private final String apiKey;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final String TRANSFERS_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";

    public CardTransferService(@Value("${adyen.balancePlatformApiKey}") String apiKey, RestTemplate restTemplate) {
        this.apiKey = apiKey;
        this.restTemplate = restTemplate;
    }

    public List<CardTransferDTO> getCardTransfers(String accountHolderId, String paymentInstrumentId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-API-Key", apiKey);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));

        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime since = now.minusDays(90);

        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(TRANSFERS_URL)
                .queryParam("accountHolderId", accountHolderId)
                .queryParam("category", "issuedCard")
                .queryParam("limit", 30)
                .queryParam("createdSince", since.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .queryParam("createdUntil", now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));

        if (paymentInstrumentId != null && !paymentInstrumentId.isBlank()) {
            builder.queryParam("paymentInstrumentId", paymentInstrumentId);
        }

        HttpEntity<Void> entity = new HttpEntity<>(headers);

        ResponseEntity<String> response = restTemplate.exchange(
                builder.toUriString(),
                HttpMethod.GET,
                entity,
                String.class
        );

        return parseTransfers(response.getBody());
    }

    private List<CardTransferDTO> parseTransfers(String json) {
        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode data = root.get("data");
            if (data == null || !data.isArray()) return List.of();

            // Group by transfer ID, keep highest sequenceNumber
            Map<String, CardTransferDTO> transferMap = new LinkedHashMap<>();

            for (JsonNode node : data) {
                CardTransferDTO dto = mapTransfer(node);
                String id = dto.getId();
                CardTransferDTO existing = transferMap.get(id);
                if (existing == null || dto.getSequenceNumber() > existing.getSequenceNumber()) {
                    transferMap.put(id, dto);
                }
            }

            // Return sorted by createdAt descending (most recent first)
            List<CardTransferDTO> result = new ArrayList<>(transferMap.values());
            result.sort((a, b) -> {
                if (a.getCreatedAt() == null) return 1;
                if (b.getCreatedAt() == null) return -1;
                return b.getCreatedAt().compareTo(a.getCreatedAt());
            });

            return result;
        } catch (Exception e) {
            e.printStackTrace();
            return List.of();
        }
    }

    private CardTransferDTO mapTransfer(JsonNode node) {
        CardTransferDTO dto = new CardTransferDTO();
        dto.setId(getText(node, "id"));
        dto.setStatus(getText(node, "status"));
        dto.setType(getText(node, "type"));
        dto.setReason(getText(node, "reason"));
        dto.setReference(getText(node, "reference"));
        dto.setDescription(getText(node, "description"));
        dto.setCreatedAt(getText(node, "createdAt"));
        dto.setUpdatedAt(getText(node, "updatedAt"));
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

        // Category data (issuedCard specific)
        JsonNode categoryData = node.get("categoryData");
        if (categoryData != null) {
            dto.setProcessingType(getText(categoryData, "processingType"));
            dto.setPanEntryMode(getText(categoryData, "panEntryMode"));
            dto.setAuthorisationType(getText(categoryData, "authorisationType"));

            // 3D Secure
            JsonNode tds = categoryData.get("threeDSecure");
            if (tds != null) {
                dto.setThreeDSecureAcsTransactionId(getText(tds, "acsTransactionId"));
            }

            // Validation facts
            JsonNode vf = categoryData.get("validationFacts");
            if (vf != null && vf.isArray()) {
                List<CardTransferDTO.ValidationFact> facts = new ArrayList<>();
                for (JsonNode fact : vf) {
                    facts.add(new CardTransferDTO.ValidationFact(
                            getText(fact, "type"),
                            getText(fact, "result")
                    ));
                }
                dto.setValidationFacts(facts);
            }
        }

        // Counterparty - merchant info
        JsonNode counterparty = node.get("counterparty");
        if (counterparty != null) {
            JsonNode merchant = counterparty.get("merchant");
            if (merchant != null) {
                dto.setMcc(getText(merchant, "mcc"));
                dto.setMerchantName(getText(merchant, "name"));

                JsonNode nameLocation = merchant.get("nameLocation");
                if (nameLocation != null) {
                    if (dto.getMerchantName() == null || dto.getMerchantName().isEmpty()) {
                        dto.setMerchantName(getText(nameLocation, "name"));
                    }
                    dto.setMerchantCity(getText(nameLocation, "city"));
                    dto.setMerchantCountry(getText(nameLocation, "country"));
                }
            }
        }

        // Events (lifecycle)
        JsonNode events = node.get("events");
        if (events != null && events.isArray()) {
            List<CardTransferDTO.TransferEvent> eventList = new ArrayList<>();
            for (JsonNode event : events) {
                CardTransferDTO.TransferEvent te = new CardTransferDTO.TransferEvent();
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

        // Transaction rules result
        JsonNode trr = node.get("transactionRulesResult");
        if (trr != null) {
            CardTransferDTO.TransactionRulesResultDTO result = new CardTransferDTO.TransactionRulesResultDTO();
            result.setAdvice(getText(trr, "advice"));
            result.setAllHardBlockRulesPassed(trr.has("allHardBlockRulesPassed") && trr.get("allHardBlockRulesPassed").asBoolean());
            result.setScore(trr.has("score") ? trr.get("score").asInt() : 0);

            JsonNode triggered = trr.get("triggeredTransactionRules");
            if (triggered != null && triggered.isArray()) {
                List<CardTransferDTO.TriggeredRule> rules = new ArrayList<>();
                for (JsonNode rule : triggered) {
                    CardTransferDTO.TriggeredRule tr = new CardTransferDTO.TriggeredRule();
                    tr.setReason(getText(rule, "reason"));
                    JsonNode txRule = rule.get("transactionRule");
                    if (txRule != null) {
                        tr.setRuleDescription(getText(txRule, "description"));
                        tr.setRuleId(getText(txRule, "id"));
                        tr.setOutcomeType(getText(txRule, "outcomeType"));
                    }
                    rules.add(tr);
                }
                result.setTriggeredRules(rules);
            }
            dto.setTransactionRulesResult(result);
        }

        return dto;
    }

    private String getText(JsonNode node, String field) {
        return node.has(field) && !node.get(field).isNull() ? node.get(field).asText() : null;
    }
}
