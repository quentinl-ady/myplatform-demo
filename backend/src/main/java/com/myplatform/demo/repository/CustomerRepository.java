package com.myplatform.demo.repository;

import com.myplatform.demo.model.Customer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CustomerRepository extends JpaRepository<Customer, Long> {

    List<Customer> findByUserId(String userId);

    Optional<Customer> findByIdAndUserId(Long id, String userId);

    Optional<Customer> findFirstByUserIdAndDemoKey(String userId, String demoKey);
}
