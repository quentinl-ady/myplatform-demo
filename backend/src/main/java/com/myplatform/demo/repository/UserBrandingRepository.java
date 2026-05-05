package com.myplatform.demo.repository;

import com.myplatform.demo.model.UserBranding;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface UserBrandingRepository extends JpaRepository<UserBranding, String> {
}
