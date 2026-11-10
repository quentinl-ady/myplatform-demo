package com.myplatform.demo.repository;

import com.myplatform.demo.model.Invoice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface InvoiceRepository extends JpaRepository<Invoice, Long> {

    List<Invoice> findByUserIdOrderBySequenceYearDescSequenceNumberDesc(String userId);

    Optional<Invoice> findByIdAndUserId(Long id, String userId);

    Optional<Invoice> findFirstByPaymentLinkId(String paymentLinkId);

    Optional<Invoice> findFirstByPspReference(String pspReference);

    Optional<Invoice> findFirstByChargeReference(String chargeReference);

    Optional<Invoice> findFirstByChargePspReference(String chargePspReference);

    Optional<Invoice> findFirstByRescueReference(String rescueReference);

    List<Invoice> findBySubscriptionIdOrderBySubscriptionCycleAsc(Long subscriptionId);

    List<Invoice> findByUserIdAndSubscriptionIdIsNotNull(String userId);

    List<Invoice> findByCustomerId(Long customerId);

    List<Invoice> findByNumberAndStatus(String number, Invoice.Status status);

    boolean existsByCustomerId(Long customerId);

    boolean existsByUserIdAndDemoKey(String userId, String demoKey);

    @Query("select max(i.sequenceNumber) from Invoice i where i.userId = :userId and i.sequenceYear = :year")
    Integer maxSequenceNumber(@Param("userId") String userId, @Param("year") int year);
}
