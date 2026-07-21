package com.myplatform.demo.controller;

import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.KycStatus;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserBrandingRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.KYCService;
import com.myplatform.demo.service.LegalEntityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/onboarding")
public class OnboardingController {

    private final UserRepository userRepository;
    private final LegalEntityService legalEntityService;
    private final KYCService kycService;
    private final UserBrandingRepository brandingRepository;

    public OnboardingController(UserRepository userRepository,
                                LegalEntityService legalEntityService,
                                KYCService kycService,
                                UserBrandingRepository brandingRepository) {
        this.userRepository = userRepository;
        this.legalEntityService = legalEntityService;
        this.kycService = kycService;
        this.brandingRepository = brandingRepository;
    }

    @GetMapping("/{userId}/link")
    public ResponseEntity<?> getOnboardingLink(@PathVariable String userId) throws Exception {
        User user = findUserWithLegalEntity(userId);
        String themeId = brandingRepository.findById(userId).map(b -> b.getThemeId()).orElse(null);
        String url = legalEntityService.createHOP(user.getLegalEntityId(), user.getCountryCode(), userId, user.getActivityReason(), themeId);
        return ResponseEntity.ok().body("{\"url\": \"" + url + "\"}");
    }

    @GetMapping("/{userId}/kyc-status")
    public ResponseEntity<KycStatus> getKYCStatus(@PathVariable String userId) throws Exception {
        User user = findUserWithLegalEntity(userId);
        KycStatus status = legalEntityService.getLegalEntityKycDetail(user.getLegalEntityId(), user.getActivityReason(), user.getBank(), user.getCapital(), user.getIssuing());
        return ResponseEntity.ok(status);
    }

    @PostMapping("/{userId}/validate-kyc")
    public ResponseEntity<Map<String, String>> validateKyc(@PathVariable String userId) throws Exception {
        User user = findUserWithLegalEntity(userId);
        kycService.validateKyc(user.getLegalEntityId(), user.getUserType(), user.getCountryCode());
        kycService.signDocument(user.getLegalEntityId(), user.getUserType(), user.getActivityReason(), user.getCapital(), user.getBank(), user.getIssuing(), user.getCountryCode());
        return ResponseEntity.ok(Map.of("status", "success", "message", "KYC processed successfully"));
    }

    private User findUserWithLegalEntity(String userId) {
        ApiLogContext.setUserId(userId);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }
        return user;
    }
}
