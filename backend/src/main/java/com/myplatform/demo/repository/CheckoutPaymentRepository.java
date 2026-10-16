package com.myplatform.demo.repository;

import com.myplatform.demo.model.CheckoutPayment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface CheckoutPaymentRepository extends JpaRepository<CheckoutPayment, String> {

    List<CheckoutPayment> findTop100ByOwnerUserIdAndStatusInOrderByCreatedAtDesc(String ownerUserId,
                                                                                Collection<CheckoutPayment.Status> statuses);

    Optional<CheckoutPayment> findFirstByPspReference(String pspReference);

    Optional<CheckoutPayment> findFirstByMerchantAccountAndMerchantReferenceAndAmountAndStatusOrderByCreatedAtDesc(
            String merchantAccount, String merchantReference, Long amount, CheckoutPayment.Status status);
}
