package com.myplatform.demo.repository;

import com.myplatform.demo.model.CheckoutPaymentOperation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface CheckoutPaymentOperationRepository extends JpaRepository<CheckoutPaymentOperation, Long> {

    Optional<CheckoutPaymentOperation> findFirstByPspReference(String pspReference);
}
