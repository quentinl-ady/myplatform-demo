package com.myplatform.demo.controller;

import com.myplatform.demo.model.ApiLog;
import com.myplatform.demo.service.ApiLogService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/api-logs")
public class ApiLogController {

    private final ApiLogService apiLogService;

    public ApiLogController(ApiLogService apiLogService) {
        this.apiLogService = apiLogService;
    }

    @GetMapping
    public ResponseEntity<List<ApiLog>> getLogs(@RequestParam(required = false) String method) {
        if (method != null && !method.isBlank()) {
            return ResponseEntity.ok(apiLogService.getByMethod(method));
        }
        return ResponseEntity.ok(apiLogService.getAll());
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<ApiLog>> getLogsByUser(@PathVariable String userId,
                                                      @RequestParam(required = false) String method) {
        if (method != null && !method.isBlank()) {
            return ResponseEntity.ok(apiLogService.getByUserIdAndMethod(userId, method));
        }
        return ResponseEntity.ok(apiLogService.getByUserId(userId));
    }

    @DeleteMapping
    public ResponseEntity<Void> clearLogs() {
        apiLogService.clearAll();
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{userId}")
    public ResponseEntity<Void> clearLogsByUser(@PathVariable String userId) {
        apiLogService.clearByUserId(userId);
        return ResponseEntity.ok().build();
    }
}
