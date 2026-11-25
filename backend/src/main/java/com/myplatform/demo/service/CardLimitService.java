package com.myplatform.demo.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.CardLimits;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Available limits of a card (GET /paymentInstruments/{id}/limits), not in the Adyen Java library yet. */
@Service
public class CardLimitService {

    private static final Logger log = LoggerFactory.getLogger(CardLimitService.class);
    private static final String PAYMENT_INSTRUMENTS_URL = "https://balanceplatform-api-test.adyen.com/bcl/v2/paymentInstruments";
    // Required by Adyen although the guide doesn't mention it; card limit rules are created for authorizations (the default).
    private static final String REQUEST_TYPE = "authorization";

    private final String apiKey;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public CardLimitService(@Value("${adyen.balancePlatformApiKey}") String apiKey, RestTemplate restTemplate) {
        this.apiKey = apiKey;
        this.restTemplate = restTemplate;
    }

    /**
     * Usage of the limits set by the given transaction rules. A rule is left out when Adyen doesn't return its usage
     * (API credential without the Bank Manage TransactionRules role, rule restriction Adyen doesn't track...).
     */
    public CardLimits getLimits(String paymentInstrumentId, List<String> transactionRuleIds) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-API-Key", apiKey);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        String calculatedAt = null;
        List<CardLimits.Usage> usages = new ArrayList<>();
        for (String ruleId : transactionRuleIds) {
            // Without transactionRuleId, Adyen only returns the limit that applies first, not one per rule.
            URI uri = UriComponentsBuilder.fromUriString(PAYMENT_INSTRUMENTS_URL)
                    .pathSegment(paymentInstrumentId, "limits")
                    .queryParam("transactionRuleId", ruleId)
                    .queryParam("requestType", REQUEST_TYPE)
                    .encode().build().toUri();
            JsonNode body;
            try {
                String json = restTemplate.exchange(uri, HttpMethod.GET, entity, String.class).getBody();
                body = objectMapper.readTree(json == null || json.isBlank() ? "{}" : json);
            } catch (RestClientException | JsonProcessingException e) {
                log.warn("No available limits for rule {} of card {}: {}", ruleId, paymentInstrumentId, e.getMessage());
                continue;
            }
            if (calculatedAt == null) {
                calculatedAt = text(body, "calculatedAt");
            }
            findUsage(body, ruleId).ifPresent(usages::add);
        }
        return new CardLimits(calculatedAt, usages);
    }

    static Optional<CardLimits.Usage> findUsage(JsonNode body, String ruleId) {
        for (JsonNode limit : body.path("amountLimits")) {
            if (isFromRule(limit, ruleId)) {
                return Optional.of(new CardLimits.Usage(ruleId, "amount",
                        limit.path("limit").path("value").asLong(),
                        limit.path("spent").path("value").asLong(),
                        limit.path("remaining").path("value").asLong(),
                        text(limit.path("limit"), "currency"),
                        text(limit.path("interval"), "type")));
            }
        }
        for (JsonNode limit : body.path("countLimits")) {
            if (isFromRule(limit, ruleId)) {
                return Optional.of(new CardLimits.Usage(ruleId, "count",
                        limit.path("limit").asLong(),
                        limit.path("spent").asLong(),
                        limit.path("remaining").asLong(),
                        null,
                        text(limit.path("interval"), "type")));
            }
        }
        return Optional.empty();
    }

    // Limits of capabilities (ATM, restricted countries...) can come with the one of the rule.
    private static boolean isFromRule(JsonNode limit, String ruleId) {
        String sourceId = text(limit.path("source"), "id");
        return sourceId == null || sourceId.equals(ruleId);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }
}
