package com.myplatform.demo.repository;

import com.myplatform.demo.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, String> {
    User findByEmail(String email);

    Optional<User> findByAccountHolderId(String accountHolderId);

    Optional<User> findByBalanceAccountId(String balanceAccountId);
}
