package com.myplatform.demo.controller;

import com.myplatform.demo.model.UserBranding;
import com.myplatform.demo.repository.UserBrandingRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.exception.ResourceNotFoundException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/users/{userId}/branding")
public class BrandingController {

    private final UserBrandingRepository brandingRepository;
    private final UserRepository userRepository;

    public BrandingController(UserBrandingRepository brandingRepository, UserRepository userRepository) {
        this.brandingRepository = brandingRepository;
        this.userRepository = userRepository;
    }

    @GetMapping
    public ResponseEntity<UserBranding> getBranding(@PathVariable String userId) {
        userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        return brandingRepository.findById(userId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.noContent().build());
    }

    @PutMapping
    public ResponseEntity<UserBranding> updateBranding(@PathVariable String userId,
                                                        @RequestBody Map<String, String> body) {
        userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        UserBranding branding = brandingRepository.findById(userId).orElseGet(() -> {
            UserBranding b = new UserBranding();
            b.setUserId(userId);
            return b;
        });

        if (body.containsKey("platformName")) {
            branding.setPlatformName(body.get("platformName"));
        }
        if (body.containsKey("logoData")) {
            branding.setLogoData(body.get("logoData"));
        }
        if (body.containsKey("logoType")) {
            branding.setLogoType(body.get("logoType"));
        }
        if (body.containsKey("themeId")) {
            branding.setThemeId(body.get("themeId"));
        }

        brandingRepository.save(branding);
        return ResponseEntity.ok(branding);
    }

    @DeleteMapping
    public ResponseEntity<Void> resetBranding(@PathVariable String userId) {
        userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        brandingRepository.deleteById(userId);
        return ResponseEntity.noContent().build();
    }
}
