package com.myplatform.demo.repository;

import com.myplatform.demo.model.CardExpenseReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface CardExpenseReceiptRepository extends JpaRepository<CardExpenseReceipt, Long> {

    /** Deletes the receipt without loading its file. */
    @Modifying
    @Query("delete from CardExpenseReceipt r where r.expenseId = :expenseId")
    int deleteByExpenseId(@Param("expenseId") Long expenseId);
}
