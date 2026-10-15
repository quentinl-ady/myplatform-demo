package com.myplatform.demo.exception;

import com.adyen.model.ApiError;
import com.adyen.model.InvalidField;
import com.adyen.service.exception.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(ResourceNotFoundException ex) {
        log.warn("Resource not found: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(BadRequestException ex) {
        log.warn("Bad request: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String, String>> handleConflict(ConflictException ex) {
        log.warn("Conflict: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<Map<String, String>> handleUnauthorized(UnauthorizedException ex) {
        log.warn("Unauthorized: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", ex.getMessage()));
    }

    /** Errors returned by the Adyen Java library (Checkout, LEM, Balance Platform, Management...). */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleAdyenApi(ApiException ex) {
        String message = messageFromBody(ex.getResponseBody());
        String errorCode = errorCodeFromBody(ex.getResponseBody());
        ApiError apiError = ex.getError();
        if (apiError != null) {
            if (message == null) {
                message = firstNonBlank(invalidFieldsMessage(apiError.getInvalidFields()), apiError.getMessage(), apiError.getTitle());
            }
            if (errorCode == null) {
                errorCode = apiError.getErrorCode();
            }
        }
        return upstreamError(ex.getStatusCode(), message, errorCode);
    }

    /** Errors from the direct RestTemplate calls to Adyen (Transfers API, transfer routes...). */
    @ExceptionHandler(HttpStatusCodeException.class)
    public ResponseEntity<Map<String, Object>> handleUpstreamHttp(HttpStatusCodeException ex) {
        String body = ex.getResponseBodyAsString();
        return upstreamError(ex.getStatusCode().value(), messageFromBody(body), errorCodeFromBody(body));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.warn("Unreadable request body: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", "The request body is missing or malformed."));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, String>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        log.warn("Invalid parameter {}: {}", ex.getName(), ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", "Invalid value for parameter '" + ex.getName() + "'."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGeneral(Exception ex) {
        // Spring MVC exceptions (unknown path, wrong method, missing parameter...) carry their own status.
        if (ex instanceof ErrorResponse errorResponse) {
            HttpStatusCode status = errorResponse.getStatusCode();
            String detail = errorResponse.getBody().getDetail();
            log.warn("Request rejected with {}: {}", status.value(), ex.getMessage());
            return ResponseEntity.status(status)
                    .body(Map.of("error", detail != null ? detail : "Request failed"));
        }
        log.error("Unexpected error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error", "details", ex.getMessage() != null ? ex.getMessage() : ex.getClass().getName()));
    }

    private ResponseEntity<Map<String, Object>> upstreamError(int upstreamStatus, String message, String errorCode) {
        // Adyen 401/403 and 5xx mean a platform configuration or availability problem, not a user error.
        HttpStatusCode status = upstreamStatus >= 400 && upstreamStatus < 500 && upstreamStatus != 401 && upstreamStatus != 403
                ? HttpStatusCode.valueOf(upstreamStatus)
                : HttpStatus.BAD_GATEWAY;
        log.warn("Adyen API error {} ({}): {}", upstreamStatus, errorCode, message);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", message != null ? message : "Adyen rejected the request (HTTP " + upstreamStatus + ").");
        if (errorCode != null) {
            body.put("errorCode", errorCode);
        }
        return ResponseEntity.status(status).body(body);
    }

    private static String messageFromBody(String body) {
        JsonNode json = parse(body);
        if (json == null) {
            return null;
        }
        List<String> fieldMessages = new ArrayList<>();
        JsonNode invalidFields = json.get("invalidFields");
        if (invalidFields != null && invalidFields.isArray()) {
            for (JsonNode field : invalidFields) {
                String fieldMessage = text(field, "message");
                if (fieldMessage != null && !fieldMessages.contains(fieldMessage)) {
                    fieldMessages.add(fieldMessage);
                }
            }
        }
        String main = firstNonBlank(text(json, "detail"), text(json, "message"), text(json, "title"));
        if (fieldMessages.isEmpty()) {
            return main;
        }
        String fields = String.join("; ", fieldMessages);
        return main != null && !main.equals(fields) ? main + ": " + fields : fields;
    }

    private static String errorCodeFromBody(String body) {
        JsonNode json = parse(body);
        return json != null ? text(json, "errorCode") : null;
    }

    private static String invalidFieldsMessage(List<InvalidField> invalidFields) {
        if (invalidFields == null || invalidFields.isEmpty()) {
            return null;
        }
        List<String> messages = new ArrayList<>();
        for (InvalidField field : invalidFields) {
            if (field.getMessage() != null && !field.getMessage().isBlank()) {
                messages.add(field.getMessage());
            }
        }
        return messages.isEmpty() ? null : String.join("; ", messages);
    }

    private static JsonNode parse(String body) {
        if (body == null || body.isBlank() || !body.trim().startsWith("{")) {
            return null;
        }
        try {
            return MAPPER.readTree(body);
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }
}
