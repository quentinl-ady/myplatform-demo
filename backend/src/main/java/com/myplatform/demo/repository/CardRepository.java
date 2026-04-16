package com.myplatform.demo.repository;

import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CardRepository extends JpaRepository<Card, Long> {
    List<Card> findByUser(User user);
    Card findByPaymentInstrumentId(String paymentInstrumentId);
}
