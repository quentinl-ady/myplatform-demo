package com.myplatform.demo.configuration;

import com.adyen.Client;
import com.adyen.Config;
import com.adyen.enums.Environment;
import com.myplatform.demo.service.ApiLogService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AdyenClientConfig {

    /**
     * A payment at a terminal waits for the shopper, so Adyen recommends a read timeout of at least 150 seconds: the
     * library's default of 60 seconds would cut payments off while the shopper is still paying.
     */
    private static final int TERMINAL_READ_TIMEOUT_MILLIS = 180_000;

    @Bean
    public Client lemClient(@Value("${adyen.lemApiKey}") String lemApiKey, ApiLogService apiLogService) {
        Client client = new Client(lemApiKey, Environment.TEST);
        client.setHttpClient(new LoggingClientWrapper(client.getHttpClient(), apiLogService, "Legal Entity Management"));
        return client;
    }

    @Bean
    public Client balancePlatformClient(@Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey, ApiLogService apiLogService) {
        Client client = new Client(balancePlatformApiKey, Environment.TEST);
        client.setHttpClient(new LoggingClientWrapper(client.getHttpClient(), apiLogService, "Balance Platform"));
        return client;
    }

    @Bean
    public Client pspClient(@Value("${adyen.pspApiKey}") String pspApiKey, ApiLogService apiLogService) {
        Client client = new Client(pspApiKey, Environment.TEST);
        client.setHttpClient(new LoggingClientWrapper(client.getHttpClient(), apiLogService, "Payments"));
        return client;
    }

    /** The payments account, for the Terminal API: its own client, for its read timeout. */
    @Bean
    public Client terminalClient(@Value("${adyen.pspApiKey}") String pspApiKey, ApiLogService apiLogService) {
        Client client = new Client(new Config()
                .apiKey(pspApiKey)
                .environment(Environment.TEST)
                .readTimeoutMillis(TERMINAL_READ_TIMEOUT_MILLIS));
        client.setHttpClient(new LoggingClientWrapper(client.getHttpClient(), apiLogService, "Terminal API"));
        return client;
    }

    @Bean
    public Client issuingPspClient(@Value("${adyen.issuing.pspApiKey}") String issuingPspApiKey, ApiLogService apiLogService) {
        Client client = new Client(issuingPspApiKey, Environment.TEST);
        client.setHttpClient(new LoggingClientWrapper(client.getHttpClient(), apiLogService, "Issuing Payments"));
        return client;
    }
}
