package com.myplatform.demo.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class StandingOrderService {

    private static final Logger log = LoggerFactory.getLogger(StandingOrderService.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE = new ParameterizedTypeReference<>() {};

    private final RestTemplate restTemplate;
    private final String balancePlatformApiKey;

    public StandingOrderService(RestTemplate restTemplate,
                                @Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey) {
        this.restTemplate = restTemplate;
        this.balancePlatformApiKey = balancePlatformApiKey;
    }

    private String standingOrdersUrl(String balanceAccountId) {
        return "https://balanceplatform-api-test.adyen.com/bcl/v2/balanceAccounts/" + balanceAccountId + "/standingOrders";
    }

    // ---- CRUD (no SCA) ----

    public Map<String, Object> listStandingOrders(String balanceAccountId) {
        String url = standingOrdersUrl(balanceAccountId);
        HttpEntity<Void> entity = new HttpEntity<>(buildHeaders(null));
        ResponseEntity<String> raw = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
        String body = raw.getBody();
        org.springframework.boot.json.JacksonJsonParser parser = new org.springframework.boot.json.JacksonJsonParser();
        if (body != null && body.trim().startsWith("[")) {
            return Map.of("standingOrders", parser.parseList(body));
        }
        try {
            return parser.parseMap(body);
        } catch (Exception e) {
            return Map.of("standingOrders", List.of());
        }
    }

    public Map<String, Object> getStandingOrder(String balanceAccountId, String standingOrderId) {
        String url = standingOrdersUrl(balanceAccountId) + "/" + standingOrderId;
        HttpEntity<Void> entity = new HttpEntity<>(buildHeaders(null));
        ResponseEntity<Map<String, Object>> response = restTemplate.exchange(url, HttpMethod.GET, entity, MAP_TYPE);
        return response.getBody();
    }

    public Map<String, Object> updateStandingOrder(String balanceAccountId, String standingOrderId, Map<String, Object> patchBody) {
        String url = standingOrdersUrl(balanceAccountId) + "/" + standingOrderId;
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(patchBody, buildHeaders(null));
        ResponseEntity<Map<String, Object>> response = restTemplate.exchange(url, HttpMethod.PATCH, entity, MAP_TYPE);
        return response.getBody();
    }

    public void deleteStandingOrder(String balanceAccountId, String standingOrderId) {
        String url = standingOrdersUrl(balanceAccountId) + "/" + standingOrderId;
        HttpEntity<Void> entity = new HttpEntity<>(buildHeaders(null));
        restTemplate.exchange(url, HttpMethod.DELETE, entity, Void.class);
    }

    // ---- SCA flow: initiate (step 1) ----

    public Map<String, Object> initiateStandingOrder(String balanceAccountId, Map<String, Object> standingOrderRequest, String sdkOutput) {
        String url = standingOrdersUrl(balanceAccountId);

        Map<String, Object> body = new HashMap<>(standingOrderRequest);
        body.put("balanceAccountId", balanceAccountId);

        HttpHeaders headers = buildHeaders(sdkOutput);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        log.info("[StandingOrder] POST {}", url);

        try {
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(url, HttpMethod.POST, entity, MAP_TYPE);
            return Map.of(
                    "status", "completed",
                    "standingOrder", response.getBody()
            );
        } catch (HttpClientErrorException.Unauthorized ex) {
            String wwwAuth = ex.getResponseHeaders() != null
                    ? ex.getResponseHeaders().getFirst("WWW-Authenticate")
                    : null;
            String authParam1 = extractAuthParam1(wwwAuth);

            Map<String, Object> result = new HashMap<>();
            result.put("status", "sca_required");
            result.put("authParam1", authParam1 != null ? authParam1 : "");
            return result;
        }
    }

    // ---- SCA flow: finalize (step 2) ----

    public Map<String, Object> finalizeStandingOrder(String balanceAccountId, Map<String, Object> standingOrderRequest, String sdkOutput) {
        String url = standingOrdersUrl(balanceAccountId);

        Map<String, Object> body = new HashMap<>(standingOrderRequest);
        body.put("balanceAccountId", balanceAccountId);

        HttpHeaders headers = buildHeaders(sdkOutput);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        ResponseEntity<Map<String, Object>> response = restTemplate.exchange(url, HttpMethod.POST, entity, MAP_TYPE);
        return response.getBody();
    }

    // ---- Helpers ----

    private HttpHeaders buildHeaders(String sdkOutput) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-api-key", balancePlatformApiKey);

        if (sdkOutput != null && !sdkOutput.isBlank()) {
            headers.set("WWW-Authenticate",
                    "SCA realm=\"StandingOrder\" auth-param1=\"" + sdkOutput + "\"");
        }

        return headers;
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
}
