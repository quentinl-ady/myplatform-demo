package com.myplatform.demo.repository;

import com.myplatform.demo.model.Subscription;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SubscriptionRepository extends JpaRepository<Subscription, Long> {

    List<Subscription> findByUserIdOrderByIdDesc(String userId);

    Optional<Subscription> findByIdAndUserId(Long id, String userId);

    boolean existsByUserIdAndDemoKey(String userId, String demoKey);

    boolean existsByCustomerId(Long customerId);
}
