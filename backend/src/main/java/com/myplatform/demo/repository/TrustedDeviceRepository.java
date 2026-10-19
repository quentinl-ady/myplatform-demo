package com.myplatform.demo.repository;

import com.myplatform.demo.model.TrustedDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TrustedDeviceRepository extends JpaRepository<TrustedDevice, String> {
    List<TrustedDevice> findByUserId(String userId);
}
