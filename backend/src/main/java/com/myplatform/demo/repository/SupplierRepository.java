package com.myplatform.demo.repository;

import com.myplatform.demo.model.Supplier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SupplierRepository extends JpaRepository<Supplier, Long> {

    List<Supplier> findByUserId(String userId);

    Optional<Supplier> findByIdAndUserId(Long id, String userId);

    Optional<Supplier> findFirstByUserIdAndDemoKey(String userId, String demoKey);
}
