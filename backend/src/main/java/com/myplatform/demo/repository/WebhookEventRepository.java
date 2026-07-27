package com.myplatform.demo.repository;

import com.myplatform.demo.model.WebhookEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface WebhookEventRepository extends JpaRepository<WebhookEvent, Long> {

    List<WebhookEvent> findByUserIdOrderByReceivedAtDesc(String userId);

    List<WebhookEvent> findTop50ByUserIdOrderByReceivedAtDesc(String userId);

    List<WebhookEvent> findByUserIdAndAcknowledgedFalseOrderByReceivedAtDesc(String userId);

    List<WebhookEvent> findTop50ByUserIdAndAcknowledgedFalseOrderByReceivedAtDesc(String userId);

    long countByUserIdAndAcknowledgedFalse(String userId);

    long countByUserId(String userId);

    @Modifying
    @Query(value = "DELETE FROM webhook_event WHERE user_id = :userId AND id NOT IN " +
           "(SELECT id FROM webhook_event WHERE user_id = :userId ORDER BY id DESC LIMIT :maxEvents)",
           nativeQuery = true)
    void trimByUserId(@Param("userId") String userId, @Param("maxEvents") int maxEvents);
}
