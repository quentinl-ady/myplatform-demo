package com.myplatform.demo.scheduler;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.ThreadLocalRandom;

@Component
public class KeepAliveScheduler {

    @Value("${app.backend.url:}")
    private String backendUrl;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Scheduled(fixedDelay = 1000) // delay is handled manually with random sleep
    public void keepAlive() {
        if (backendUrl == null || backendUrl.isBlank()) {
            return;
        }
        try {
            long delayMs = ThreadLocalRandom.current().nextLong(8 * 60 * 1000, 12 * 60 * 1000);
            Thread.sleep(delayMs);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(backendUrl + "/api/health"))
                    .GET()
                    .build();
            httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception ignored) {
        }
    }
}
