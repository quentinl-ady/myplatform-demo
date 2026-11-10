package com.myplatform.demo.repository;

import com.myplatform.demo.model.CardExpense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface CardExpenseRepository extends JpaRepository<CardExpense, Long> {

    List<CardExpense> findByUserId(String userId);

    List<CardExpense> findByUserIdAndTransferIdIn(String userId, Collection<String> transferIds);

    Optional<CardExpense> findFirstByUserIdAndTransferId(String userId, String transferId);
}
