package com.myplatform.demo.configuration;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import java.util.Map;

@Component
public class ApiLogUserInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // 1. Check @PathVariable userId
        @SuppressWarnings("unchecked")
        Map<String, String> pathVars = (Map<String, String>)
                request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);

        if (pathVars != null && pathVars.containsKey("userId")) {
            ApiLogContext.setUserId(pathVars.get("userId"));
            return true;
        }

        // 2. Check @RequestParam userId
        String userIdParam = request.getParameter("userId");
        if (userIdParam != null && !userIdParam.isBlank()) {
            ApiLogContext.setUserId(userIdParam);
        }

        return true;
    }
}
