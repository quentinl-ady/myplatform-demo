package com.myplatform.demo.configuration;

import com.adyen.Client;
import com.adyen.enums.Environment;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AdyenClientConfig {

    @Bean
    public Client lemClient(@Value("${adyen.lemApiKey}") String lemApiKey) {
        return new Client(lemApiKey, Environment.TEST);
    }

    @Bean
    public Client balancePlatformClient(@Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey) {
        return new Client(balancePlatformApiKey, Environment.TEST);
    }

    @Bean
    public Client pspClient(@Value("${adyen.pspApiKey}") String pspApiKey) {
        return new Client(pspApiKey, Environment.TEST);
    }
}
