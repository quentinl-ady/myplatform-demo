package com.myplatform.demo.service;

import com.myplatform.demo.model.ApiLog;
import com.myplatform.demo.repository.ApiLogRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ApiLogService {

    private static final int MAX_LOGS_PER_USER = 50;
    private static final int TRIM_THRESHOLD = MAX_LOGS_PER_USER + 5;

    private final ApiLogRepository apiLogRepository;

    public ApiLogService(ApiLogRepository apiLogRepository) {
        this.apiLogRepository = apiLogRepository;
    }

    @Transactional
    public ApiLog save(ApiLog log) {
        ApiLog saved = apiLogRepository.save(log);
        if (log.getUserId() != null) {
            long count = apiLogRepository.countByUserId(log.getUserId());
            if (count > TRIM_THRESHOLD) {
                apiLogRepository.trimByUserId(log.getUserId(), MAX_LOGS_PER_USER);
            }
        }
        return saved;
    }

    public List<ApiLog> getAll() {
        return apiLogRepository.findAllByOrderByTimestampDesc();
    }

    public List<ApiLog> getByMethod(String method) {
        return apiLogRepository.findByHttpMethodOrderByTimestampDesc(method.toUpperCase());
    }

    public List<ApiLog> getByUserId(String userId) {
        return apiLogRepository.findByUserIdOrderByTimestampDesc(userId);
    }

    public List<ApiLog> getByUserIdAndMethod(String userId, String method) {
        return apiLogRepository.findByUserIdAndHttpMethodOrderByTimestampDesc(userId, method.toUpperCase());
    }

    @Transactional
    public void clearAll() {
        apiLogRepository.deleteAll();
    }

    @Transactional
    public void clearByUserId(String userId) {
        apiLogRepository.deleteByUserId(userId);
    }
}
