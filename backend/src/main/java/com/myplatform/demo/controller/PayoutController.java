package com.myplatform.demo.controller;

import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.PayoutAccount;
import com.myplatform.demo.model.PayoutConfigurationRequest;
import com.myplatform.demo.model.PayoutConfigurationResponse;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.LegalEntityService;
import com.myplatform.demo.service.PayoutConfigurationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/payouts")
public class PayoutController {

    private final UserRepository userRepository;
    private final LegalEntityService legalEntityService;
    private final PayoutConfigurationService payoutConfigurationService;

    public PayoutController(UserRepository userRepository,
                            LegalEntityService legalEntityService,
                            PayoutConfigurationService payoutConfigurationService) {
        this.userRepository = userRepository;
        this.legalEntityService = legalEntityService;
        this.payoutConfigurationService = payoutConfigurationService;
    }

    @GetMapping("/{userId}/accounts")
    public ResponseEntity<List<PayoutAccount>> getPayoutAccounts(@PathVariable Long userId) throws Exception {
        User user = findUserWithLegalEntity(userId);
        return ResponseEntity.ok(legalEntityService.getPayoutAccounts(user.getLegalEntityId()));
    }

    @GetMapping("/{userId}/configurations/{balanceAccountId}")
    public ResponseEntity<List<PayoutConfigurationResponse>> getPayoutConfigurations(@PathVariable Long userId, @PathVariable String balanceAccountId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        return ResponseEntity.ok(payoutConfigurationService.getPayoutConfigurations(user, balanceAccountId));
    }

    @PostMapping("/configurations")
    public ResponseEntity<PayoutConfigurationResponse> createPayoutConfiguration(@RequestBody PayoutConfigurationRequest request) throws Exception {
        User user = userRepository.findById(request.getUserId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }

        return ResponseEntity.ok(payoutConfigurationService.createPayoutConfiguration(
                request.getBalanceAccountId(),
                request.getCurrencyCode(),
                request.getRegular(),
                request.getInstant(),
                request.getTransferInstrumentId(),
                request.getSchedule()));
    }

    private User findUserWithLegalEntity(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }
        return user;
    }
}
