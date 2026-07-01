package com.myplatform.demo.repository;

import com.myplatform.demo.model.WebhookEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface WebhookEventRepository extends JpaRepository<WebhookEvent, Long> {

    List<WebhookEvent> findByUserIdOrderByReceivedAtDesc(String userId);

    List<WebhookEvent> findByUserIdAndAcknowledgedFalseOrderByReceivedAtDesc(String userId);

    long countByUserIdAndAcknowledgedFalse(String userId);
}
