package com.myplatform.demo.controller;

import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.AdyenSessionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final UserRepository userRepository;
    private final AdyenSessionService adyenSessionService;

    public SessionController(UserRepository userRepository,
                             AdyenSessionService adyenSessionService) {
        this.userRepository = userRepository;
        this.adyenSessionService = adyenSessionService;
    }

    @GetMapping("/{userId}/payments")
    public ResponseEntity<?> getPaymentInformation(@PathVariable Long userId) throws Exception {
        User user = findUserWithAccountHolder(userId);
        return ResponseEntity.ok(adyenSessionService.createSession(user.getAccountHolderId(), new String[]{
                "Transactions Overview Component: View",
                "Transactions Overview Component: Manage Refunds"
        }));
    }

    @GetMapping("/{userId}/reports")
    public ResponseEntity<?> getReportInformation(@PathVariable Long userId) throws Exception {
        User user = findUserWithAccountHolder(userId);
        return ResponseEntity.ok(adyenSessionService.createSession(user.getAccountHolderId(), new String[]{
                "Reports Overview Component: View"
        }));
    }

    @GetMapping("/{userId}/payouts")
    public ResponseEntity<?> getPayoutInformation(@PathVariable Long userId) throws Exception {
        User user = findUserWithAccountHolder(userId);
        return ResponseEntity.ok(adyenSessionService.createSession(user.getAccountHolderId(), new String[]{
                "Payouts Overview Component: View"
        }));
    }

    @GetMapping("/{userId}/disputes")
    public ResponseEntity<?> getDisputeInformation(@PathVariable Long userId) throws Exception {
        User user = findUserWithAccountHolder(userId);
        return ResponseEntity.ok(adyenSessionService.createSession(user.getAccountHolderId(), new String[]{
                "Disputes Component: Manage"
        }));
    }

    @GetMapping("/{userId}/business-loans")
    public ResponseEntity<?> getBusinessLoansInformation(@PathVariable Long userId) throws Exception {
        User user = findUserWithAccountHolder(userId);
        return ResponseEntity.ok(adyenSessionService.createSession(user.getAccountHolderId(), new String[]{
                "Capital Component: Manage"
        }));
    }

    @GetMapping("/{userId}/pay-by-link")
    public ResponseEntity<?> getPayByLinksInformation(@PathVariable Long userId) throws Exception {
        User user = findUserWithAccountHolder(userId);
        return ResponseEntity.ok(adyenSessionService.createSession(user.getAccountHolderId(), new String[]{
                "Pay By Link Component: View",
                "Pay By Link Component: View PII",
                "Pay By Link Component: Manage Links",
                "Pay By Link Component: Manage Settings"
        }));
    }

    @GetMapping("/{userId}/external-bank-account")
    public ResponseEntity<?> getExternalBankAccountSession(@PathVariable Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }
        return ResponseEntity.ok(adyenSessionService.createSessionWithLemKey(user.getLegalEntityId(), new String[]{
                "transferInstrumentConfiguration",
                "transferInstrumentManagement"
        }));
    }

    private User findUserWithAccountHolder(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no accountHolderId");
        }
        return user;
    }
}
