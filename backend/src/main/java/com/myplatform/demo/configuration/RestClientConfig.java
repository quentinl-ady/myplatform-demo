package com.myplatform.demo.configuration;

import com.myplatform.demo.service.ApiLogService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.BufferingClientHttpRequestFactory;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.util.List;

@Configuration
public class RestClientConfig {

    @Bean
    public RestTemplate restTemplate(ApiLogService apiLogService) {
        RestTemplate restTemplate = new RestTemplate(
                new BufferingClientHttpRequestFactory(new HttpComponentsClientHttpRequestFactory()));
        restTemplate.setInterceptors(List.of(new AdyenRestTemplateInterceptor(apiLogService)));
        return restTemplate;
    }
}
