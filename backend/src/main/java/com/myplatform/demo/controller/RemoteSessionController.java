package com.myplatform.demo.controller;

import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.PairingRequest;
import com.myplatform.demo.dto.PhoneStepRequest;
import com.myplatform.demo.dto.RemoteApprovalRequest;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BankAccountResolver;
import com.myplatform.demo.service.OtpService;
import com.myplatform.demo.service.RemoteSessionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Sessions between the computer, which shows a QR code and follows the session, and the phone that
 * opened its link. The /phone endpoints only take the token of the link.
 */
@RestController
@RequestMapping("/api/remote-sessions")
public class RemoteSessionController {

    private final RemoteSessionService remoteSessions;
    private final UserRepository userRepository;
    private final OtpService otpService;
    private final BankAccountResolver bankAccounts;

    public RemoteSessionController(RemoteSessionService remoteSessions,
                                   UserRepository userRepository,
                                   OtpService otpService,
                                   BankAccountResolver bankAccounts) {
        this.remoteSessions = remoteSessions;
        this.userRepository = userRepository;
        this.otpService = otpService;
        this.bankAccounts = bankAccounts;
    }

    // ---- Computer ----

    @PostMapping("/pairing")
    public ResponseEntity<?> createPairing(@RequestBody PairingRequest request) throws Exception {
        User user = findUser(request.userId());
        if (!bankAccounts.hasBankAccount(user)) {
            throw new BadRequestException(TransferController.NO_BANK_ACCOUNT_MESSAGE);
        }
        if (request.otpCode() == null || !otpService.verifyOtp(user.getId(), request.otpCode().trim())) {
            return ResponseEntity.status(403).body(Map.of("error", "Invalid or expired OTP code"));
        }
        return ResponseEntity.ok(remoteSessions.createPairing(user, request.deviceName()));
    }

    @PostMapping("/approvals")
    public ResponseEntity<Map<String, Object>> createApproval(@RequestBody RemoteApprovalRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.createApproval(request));
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String sessionId, @RequestParam String userId) {
        return ResponseEntity.ok(remoteSessions.status(sessionId, userId));
    }

    @PostMapping("/{sessionId}/cancel")
    public ResponseEntity<Map<String, Object>> cancel(@PathVariable String sessionId,
                                                      @RequestBody Map<String, String> payload) {
        return ResponseEntity.ok(remoteSessions.cancel(sessionId, payload.get("userId")));
    }

    // ---- Phone ----

    @PostMapping("/phone/open")
    public ResponseEntity<Map<String, Object>> open(@RequestBody PhoneStepRequest request) {
        return ResponseEntity.ok(remoteSessions.phoneOpen(request));
    }

    @PostMapping("/phone/status")
    public ResponseEntity<Map<String, Object>> phoneStatus(@RequestBody PhoneStepRequest request) {
        return ResponseEntity.ok(remoteSessions.phoneStatus(request));
    }

    @PostMapping("/phone/decline")
    public ResponseEntity<Map<String, Object>> decline(@RequestBody PhoneStepRequest request) {
        return ResponseEntity.ok(remoteSessions.phoneDecline(request));
    }

    @PostMapping("/phone/register")
    public ResponseEntity<Map<String, Object>> register(@RequestBody PhoneStepRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.phoneRegister(request));
    }

    @PostMapping("/phone/register/finalize")
    public ResponseEntity<Map<String, Object>> finalizeRegistration(@RequestBody PhoneStepRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.phoneFinishRegistration(request));
    }

    @PostMapping("/phone/associate")
    public ResponseEntity<Map<String, Object>> associate(@RequestBody PhoneStepRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.phoneAssociate(request));
    }

    @PostMapping("/phone/associate/finalize")
    public ResponseEntity<Map<String, Object>> finalizeAssociation(@RequestBody PhoneStepRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.phoneFinishAssociation(request));
    }

    @PostMapping("/phone/challenge")
    public ResponseEntity<Map<String, Object>> challenge(@RequestBody PhoneStepRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.phoneChallenge(request));
    }

    @PostMapping("/phone/approve")
    public ResponseEntity<Map<String, Object>> approve(@RequestBody PhoneStepRequest request) throws Exception {
        return ResponseEntity.ok(remoteSessions.phoneApprove(request));
    }

    private User findUser(String userId) {
        if (userId == null || userId.isBlank()) {
            throw new BadRequestException("userId is required");
        }
        ApiLogContext.setUserId(userId);
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
