package com.myplatform.demo.repository;

import com.myplatform.demo.model.ApiLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ApiLogRepository extends JpaRepository<ApiLog, Long> {

    List<ApiLog> findAllByOrderByTimestampDesc();

    List<ApiLog> findByHttpMethodOrderByTimestampDesc(String httpMethod);

    List<ApiLog> findByUserIdOrderByTimestampDesc(String userId);

    List<ApiLog> findByUserIdAndHttpMethodOrderByTimestampDesc(String userId, String httpMethod);

    void deleteByUserId(String userId);

    long countByUserId(String userId);

    @Modifying
    @Query(value = "DELETE FROM api_log WHERE user_id = :userId AND id NOT IN " +
            "(SELECT id FROM api_log WHERE user_id = :userId ORDER BY id DESC LIMIT :maxLogs)",
            nativeQuery = true)
    void trimByUserId(@Param("userId") String userId, @Param("maxLogs") int maxLogs);
}
