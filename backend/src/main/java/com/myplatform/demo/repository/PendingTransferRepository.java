package com.myplatform.demo.repository;

import com.myplatform.demo.model.PendingTransfer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PendingTransferRepository extends JpaRepository<PendingTransfer, String> {
    List<PendingTransfer> findByAccountHolderId(String accountHolderId);
    void deleteByTransferIdIn(List<String> transferIds);
}
