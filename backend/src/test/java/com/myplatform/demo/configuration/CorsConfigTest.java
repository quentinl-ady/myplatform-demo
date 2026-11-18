package com.myplatform.demo.configuration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.servlet.config.annotation.CorsRegistry;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class CorsConfigTest {

    private static final String FRONTEND = "https://app.example.com";
    private static final String LOCAL_PAGE = "http://192.168.1.20:4200";

    private UrlBasedCorsConfigurationSource source;

    @BeforeEach
    void setUp() {
        CorsConfig config = new CorsConfig(null);
        ReflectionTestUtils.setField(config, "frontendUrl", FRONTEND);
        Registry registry = new Registry();
        config.addCorsMappings(registry);
        // As Spring MVC registers them.
        source = new UrlBasedCorsConfigurationSource();
        source.setCorsConfigurations(registry.configurations());
    }

    @Test
    void theTerminalEndpointsAcceptAnyOriginWithoutCredentials() throws Exception {
        MockHttpServletResponse preflight = process(preflight("/api/terminals/S1F2-000158213200001/invoices/7/payment", LOCAL_PAGE));
        assertEquals(200, preflight.getStatus());
        assertEquals("*", preflight.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        assertNotNull(preflight.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS));
        assertNull(preflight.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));

        MockHttpServletResponse get = process(request("GET", "/api/terminals/S1F2-000158213200001/invoices", LOCAL_PAGE));
        assertEquals(200, get.getStatus());
        assertEquals("*", get.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void theOtherEndpointsOnlyAcceptTheFrontend() throws Exception {
        assertEquals(403, process(request("GET", "/api/invoices/1", LOCAL_PAGE)).getStatus());
        assertEquals(403, process(preflight("/api/invoices/1/7/terminal-payment", LOCAL_PAGE)).getStatus());

        MockHttpServletResponse frontend = process(request("GET", "/api/invoices/1", FRONTEND));
        assertEquals(200, frontend.getStatus());
        assertEquals(FRONTEND, frontend.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        assertEquals("true", frontend.getHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));
    }

    private MockHttpServletResponse process(MockHttpServletRequest request) throws Exception {
        CorsConfiguration configuration = source.getCorsConfiguration(request);
        assertNotNull(configuration, request.getRequestURI());
        MockHttpServletResponse response = new MockHttpServletResponse();
        new DefaultCorsProcessor().processRequest(configuration, request, response);
        return response;
    }

    private static MockHttpServletRequest request(String method, String path, String origin) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.setServerName("api.example.com");
        request.addHeader(HttpHeaders.ORIGIN, origin);
        return request;
    }

    private static MockHttpServletRequest preflight(String path, String origin) {
        MockHttpServletRequest request = request("OPTIONS", path, origin);
        request.addHeader(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST");
        request.addHeader(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type");
        return request;
    }

    private static class Registry extends CorsRegistry {
        Map<String, CorsConfiguration> configurations() {
            return getCorsConfigurations();
        }
    }
}
