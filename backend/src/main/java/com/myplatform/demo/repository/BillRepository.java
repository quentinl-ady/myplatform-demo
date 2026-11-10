package com.myplatform.demo.repository;

import com.myplatform.demo.model.Bill;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface BillRepository extends JpaRepository<Bill, Long> {

    List<Bill> findByUserIdOrderBySequenceYearDescSequenceNumberDesc(String userId);

    Optional<Bill> findByIdAndUserId(Long id, String userId);

    Optional<Bill> findFirstByTransferId(String transferId);

    Optional<Bill> findFirstByPaymentInstrumentId(String paymentInstrumentId);

    Optional<Bill> findFirstByUserIdAndPaymentInstrumentId(String userId, String paymentInstrumentId);

    List<Bill> findByUserIdAndPaymentInstrumentIdIn(String userId, Collection<String> paymentInstrumentIds);

    List<Bill> findBySupplierId(Long supplierId);

    boolean existsBySupplierId(Long supplierId);

    boolean existsByUserIdAndDemoKey(String userId, String demoKey);

    @Query("select max(b.sequenceNumber) from Bill b where b.userId = :userId and b.sequenceYear = :year")
    Integer maxSequenceNumber(@Param("userId") String userId, @Param("year") int year);
}
