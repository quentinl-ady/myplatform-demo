package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.BalanceAccount;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.CashManagementService;
import com.myplatform.demo.service.PayoutConfigurationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/cash-management")
public class CashManagementController {

    private final UserRepository userRepository;
    private final BalanceAccountService balanceAccountService;
    private final CashManagementService cashManagementService;
    private final PayoutConfigurationService payoutConfigurationService;

    public CashManagementController(UserRepository userRepository,
                                    BalanceAccountService balanceAccountService,
                                    CashManagementService cashManagementService,
                                    PayoutConfigurationService payoutConfigurationService) {
        this.userRepository = userRepository;
        this.balanceAccountService = balanceAccountService;
        this.cashManagementService = cashManagementService;
        this.payoutConfigurationService = payoutConfigurationService;
    }

    @PostMapping("/{userId}/balance-accounts")
    public ResponseEntity<BalanceAccountInfoCustomer> createBalanceAccount(
            @PathVariable String userId,
            @RequestBody CreateBalanceAccountRequest request) throws Exception {
        User user = findUserWithAccountHolder(userId);
        BalanceAccount ba = balanceAccountService.createNewBalanceAccount(
                user.getAccountHolderId(), request.getDescription());

        BalanceAccountInfoCustomer result = new BalanceAccountInfoCustomer();
        result.setBalanceAccountId(ba.getId());
        result.setCurrencyCode(ba.getDefaultCurrencyCode());
        result.setDescription(ba.getDescription());
        result.setStatus(ba.getStatus() != null ? ba.getStatus().getValue() : null);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/internal-transfer")
    public ResponseEntity<Map<String, Object>> internalTransfer(
            @RequestBody InternalTransferRequest request) throws Exception {
        findUserWithAccountHolder(request.getUserId());
        Map<String, Object> result = cashManagementService.executeInternalTransfer(
                request.getSourceBalanceAccountId(),
                request.getDestinationBalanceAccountId(),
                request.getCurrency(),
                request.getAmount(),
                request.getDescription());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/cashout")
    public ResponseEntity<Map<String, Object>> cashout(
            @RequestBody CashoutRequest request) throws Exception {
        findUserWithAccountHolder(request.getUserId());
        Map<String, Object> result = cashManagementService.executeCashout(
                request.getBalanceAccountId(),
                request.getCurrency(),
                request.getAmount(),
                request.getTransferInstrumentId(),
                request.getDescription());
        return ResponseEntity.ok(result);
    }

    @PatchMapping("/{userId}/balance-accounts/{balanceAccountId}/sweeps/{sweepId}")
    public ResponseEntity<Map<String, String>> updateSweepStatus(
            @PathVariable String userId,
            @PathVariable String balanceAccountId,
            @PathVariable String sweepId,
            @RequestBody Map<String, Boolean> body) throws Exception {
        findUserWithAccountHolder(userId);
        boolean active = Boolean.TRUE.equals(body.get("active"));
        payoutConfigurationService.updateSweepStatus(balanceAccountId, sweepId, active);
        return ResponseEntity.ok(Map.of("status", active ? "active" : "inactive"));
    }

    @GetMapping("/check-instant")
    public ResponseEntity<Map<String, Object>> checkInstantEligibility(
            @RequestParam String balanceAccountId,
            @RequestParam String transferInstrumentId,
            @RequestParam String currency) throws Exception {
        Map<String, Object> result = cashManagementService.checkInstantEligibility(
                balanceAccountId, transferInstrumentId, currency);
        return ResponseEntity.ok(result);
    }

    private User findUserWithAccountHolder(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no accountHolderId");
        }
        return user;
    }
}
