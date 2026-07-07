package com.myplatform.demo.configuration;

import com.adyen.Config;
import com.adyen.constants.ApiConstants;
import com.adyen.httpclient.ClientInterface;
import com.adyen.httpclient.HTTPClientException;
import com.adyen.model.RequestOptions;
import com.myplatform.demo.model.ApiLog;
import com.myplatform.demo.service.ApiLogService;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Map;

public class LoggingClientWrapper implements ClientInterface {

    private final ClientInterface delegate;
    private final ApiLogService apiLogService;
    private final String apiDomain;

    public LoggingClientWrapper(ClientInterface delegate, ApiLogService apiLogService, String apiDomain) {
        this.delegate = delegate;
        this.apiLogService = apiLogService;
        this.apiDomain = apiDomain;
    }

    @Override
    public String request(String endpoint, String json, Config config) throws IOException, HTTPClientException {
        return logAndDelegate(endpoint, json, "POST", () -> delegate.request(endpoint, json, config));
    }

    @Override
    public String request(String endpoint, String json, Config config, boolean isApiKeyRequired) throws IOException, HTTPClientException {
        return logAndDelegate(endpoint, json, "POST", () -> delegate.request(endpoint, json, config, isApiKeyRequired));
    }

    @Override
    public String request(String endpoint, String json, Config config, boolean isApiKeyRequired, RequestOptions requestOptions) throws IOException, HTTPClientException {
        return logAndDelegate(endpoint, json, "POST", () -> delegate.request(endpoint, json, config, isApiKeyRequired, requestOptions));
    }

    @Override
    public String request(String endpoint, String json, Config config, boolean isApiKeyRequired, RequestOptions requestOptions, ApiConstants.HttpMethod httpMethod) throws IOException, HTTPClientException {
        String method = httpMethod != null ? httpMethod.name() : "POST";
        return logAndDelegate(endpoint, json, method, () -> delegate.request(endpoint, json, config, isApiKeyRequired, requestOptions, httpMethod));
    }

    @Override
    public String request(String endpoint, String json, Config config, boolean isApiKeyRequired, RequestOptions requestOptions, ApiConstants.HttpMethod httpMethod, Map<String, String> params) throws IOException, HTTPClientException {
        String method = httpMethod != null ? httpMethod.name() : "POST";
        String fullEndpoint = appendParams(endpoint, params);
        return logAndDelegate(fullEndpoint, json, method, () -> delegate.request(endpoint, json, config, isApiKeyRequired, requestOptions, httpMethod, params));
    }

    private String logAndDelegate(String endpoint, String requestBody, String method, RequestExecutor executor) throws IOException, HTTPClientException {
        long start = System.currentTimeMillis();
        try {
            String response = executor.execute();
            long duration = System.currentTimeMillis() - start;
            saveLog(method, endpoint, requestBody, response, 200, duration, false);
            return response;
        } catch (HTTPClientException e) {
            long duration = System.currentTimeMillis() - start;
            saveLog(method, endpoint, requestBody, e.getResponseBody(), e.getCode(), duration, true);
            throw e;
        } catch (IOException e) {
            long duration = System.currentTimeMillis() - start;
            saveLog(method, endpoint, requestBody, e.getMessage(), 0, duration, true);
            throw e;
        }
    }

    private void saveLog(String method, String endpoint, String requestBody, String responseBody, int statusCode, long durationMs, boolean isError) {
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

    private String appendParams(String endpoint, Map<String, String> params) {
        if (params == null || params.isEmpty()) return endpoint;
        StringBuilder sb = new StringBuilder(endpoint);
        sb.append('?');
        boolean first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) sb.append('&');
            sb.append(entry.getKey()).append('=').append(entry.getValue());
            first = false;
        }
        return sb.toString();
    }

    @FunctionalInterface
    private interface RequestExecutor {
        String execute() throws IOException, HTTPClientException;
    }
}
