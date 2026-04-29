package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AdyenSessionService {

    private static final long CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    private final String balancePlatformApiKey;
    private final String lemApiKey;
    private final String frontendUrl;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, CachedSession> sessionCache = new ConcurrentHashMap<>();

    public AdyenSessionService(@Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                               @Value("${adyen.lemApiKey}") String lemApiKey,
                               @Value("${app.frontend.url}") String frontendUrl) {
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.lemApiKey = lemApiKey;
        this.frontendUrl = frontendUrl;
        this.httpClient = HttpClient.newHttpClient();
        this.objectMapper = new ObjectMapper();
    }

    public String createSession(String accountHolderId, String[] roles) throws Exception {
        String cacheKey = "platform:" + accountHolderId + ":" + Arrays.toString(roles);
        CachedSession cached = sessionCache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            return cached.response;
        }

        Map<String, Object> requestBody = Map.of(
                "allowOrigin", frontendUrl,
                "product", "platform",
                "policy", Map.of(
                        "resources", new Map[]{Map.of(
                                "accountHolderId", accountHolderId,
                                "type", "accountHolder"
                        )},
                        "roles", roles
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
            sessionCache.put(cacheKey, new CachedSession(response.body()));
            return response.body();
        } else {
            throw new RuntimeException("Error create session: " + response.body());
        }
    }

    public String createSessionWithLemKey(String legalEntityId, String[] roles) throws Exception {
        String cacheKey = "onboarding:" + legalEntityId + ":" + Arrays.toString(roles);
        CachedSession cached = sessionCache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            return cached.response;
        }

        Map<String, Object> requestBody = Map.of(
                "allowOrigin", frontendUrl,
                "product", "onboarding",
                "policy", Map.of(
                        "resources", new Map[]{Map.of(
                                "legalEntityId", legalEntityId,
                                "type", "legalEntity"
                        )},
                        "roles", roles
                )
        );

        String json = objectMapper.writeValueAsString(requestBody);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://test.adyen.com/authe/api/v1/sessions"))
                .header("Content-Type", "application/json")
                .header("x-api-key", lemApiKey)
                .POST(BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());

        if (response.statusCode() >= 200 && response.statusCode() < 300) {
            sessionCache.put(cacheKey, new CachedSession(response.body()));
            return response.body();
        } else {
            throw new RuntimeException("Error create session with LEM key: " + response.body());
        }
    }

    private static class CachedSession {
        final String response;
        final long createdAt;

        CachedSession(String response) {
            this.response = response;
            this.createdAt = System.currentTimeMillis();
        }

        boolean isExpired() {
            return System.currentTimeMillis() - createdAt > CACHE_TTL_MS;
        }
    }
}
