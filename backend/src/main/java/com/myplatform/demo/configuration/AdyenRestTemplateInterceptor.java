package com.myplatform.demo.configuration;

import com.myplatform.demo.model.ApiLog;
import com.myplatform.demo.service.ApiLogService;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;

public class AdyenRestTemplateInterceptor implements ClientHttpRequestInterceptor {

    private final ApiLogService apiLogService;

    public AdyenRestTemplateInterceptor(ApiLogService apiLogService) {
        this.apiLogService = apiLogService;
    }

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution) throws IOException {
        String url = request.getURI().toString();

        if (!url.contains("adyen.com")) {
            return execution.execute(request, body);
        }

        String method = request.getMethod().name();
        String requestBody = body.length > 0 ? new String(body, StandardCharsets.UTF_8) : "";
        String apiDomain = resolveApiDomain(url);
        long start = System.currentTimeMillis();

        try {
            ClientHttpResponse response = execution.execute(request, body);
            long duration = System.currentTimeMillis() - start;

            String responseBody = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
            int statusCode = response.getStatusCode().value();
            boolean isError = statusCode >= 400;

            saveLog(method, url, apiDomain, requestBody, responseBody, statusCode, duration, isError);

            return new BufferingClientHttpResponseWrapper(response, responseBody);
        } catch (IOException e) {
            long duration = System.currentTimeMillis() - start;
            saveLog(method, url, apiDomain, requestBody, e.getMessage(), 0, duration, true);
            throw e;
        }
    }

    private void saveLog(String method, String endpoint, String apiDomain, String requestBody, String responseBody, int statusCode, long durationMs, boolean isError) {
        try {
            ApiLog log = new ApiLog();
            log.setUserId(ApiLogContext.getUserId());
            log.setHttpMethod(method);
            log.setEndpoint(endpoint);
            log.setApiDomain(apiDomain);
            log.setRequestBody(requestBody);
            log.setResponseBody(responseBody);
            log.setStatusCode(statusCode);
            log.setDurationMs(durationMs);
            log.setError(isError);
            log.setTimestamp(LocalDateTime.now());
            apiLogService.save(log);
        } catch (Exception ex) {
            // Never let logging break the actual API call
        }
    }

    private String resolveApiDomain(String url) {
        if (url.contains("/btl/")) return "Transfers";
        if (url.contains("/bcl/")) return "Balance Platform";
        if (url.contains("/lem/")) return "Legal Entity Management";
        if (url.contains("/merchants/")) return "Management API";
        if (url.contains("balanceplatform-api")) return "Balance Platform";
        if (url.contains("checkout")) return "Checkout";
        return "Adyen API";
    }
}
