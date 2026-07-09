package com.myplatform.demo.configuration;

import com.adyen.Client;
import com.adyen.enums.Environment;
import com.myplatform.demo.service.ApiLogService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AdyenClientConfig {

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

    @Bean
    public Client issuingPspClient(@Value("${adyen.issuing.pspApiKey}") String issuingPspApiKey, ApiLogService apiLogService) {
        Client client = new Client(issuingPspApiKey, Environment.TEST);
        client.setHttpClient(new LoggingClientWrapper(client.getHttpClient(), apiLogService, "Issuing Payments"));
        return client;
    }
}
