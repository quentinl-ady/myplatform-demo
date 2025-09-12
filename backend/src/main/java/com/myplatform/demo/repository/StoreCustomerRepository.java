package com.myplatform.demo.repository;

import com.myplatform.demo.model.StoreCustomer;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StoreCustomerRepository extends JpaRepository<StoreCustomer, Long> {
    StoreCustomer findByStoreRef(String storeRef);
}
