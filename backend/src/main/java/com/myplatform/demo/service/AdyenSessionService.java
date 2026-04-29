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
import java.util.Map;

@Service
public class AdyenSessionService {

    private final String balancePlatformApiKey;
    private final String lemApiKey;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public AdyenSessionService(@Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                               @Value("${adyen.lemApiKey}") String lemApiKey) {
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.lemApiKey = lemApiKey;
        this.httpClient = HttpClient.newHttpClient();
        this.objectMapper = new ObjectMapper();
    }

    public String createSession(String accountHolderId, String[] roles) throws Exception {
        Map<String, Object> requestBody = Map.of(
                "allowOrigin", "http://localhost",
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
            return response.body();
        } else {
            throw new RuntimeException("Error create session: " + response.body());
        }
    }

    public String createSessionWithLemKey(String legalEntityId, String[] roles) throws Exception {
        Map<String, Object> requestBody = Map.of(
                "allowOrigin", "http://localhost",
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
            return response.body();
        } else {
            throw new RuntimeException("Error create session with LEM key: " + response.body());
        }
    }
}
