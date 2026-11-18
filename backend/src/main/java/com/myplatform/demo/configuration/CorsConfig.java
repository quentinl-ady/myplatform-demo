package com.myplatform.demo.configuration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value("${app.frontend.url}")
    private String frontendUrl;

    private final ApiLogUserInterceptor apiLogUserInterceptor;

    public CorsConfig(ApiLogUserInterceptor apiLogUserInterceptor) {
        this.apiLogUserInterceptor = apiLogUserInterceptor;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // The terminal page calls these from wherever the web app is served, e.g. a computer on the local network,
        // and sends no credentials. The first mapping that matches a request applies, so this one comes first.
        registry.addMapping("/api/terminals/**")
                .allowedOrigins("*")
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("*");
        registry.addMapping("/**")
                .allowedOrigins(frontendUrl)
                .allowedMethods("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(apiLogUserInterceptor).addPathPatterns("/api/**");
    }
}
