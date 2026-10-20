package com.myplatform.demo.repository;

import com.myplatform.demo.model.AccountStatement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface AccountStatementRepository extends JpaRepository<AccountStatement, String> {

    List<AccountStatement> findTop10ByAccountHolderIdOrderByCreationDateDesc(String accountHolderId);

    Optional<AccountStatement> findByFileNameAndAccountHolderId(String fileName, String accountHolderId);
}
