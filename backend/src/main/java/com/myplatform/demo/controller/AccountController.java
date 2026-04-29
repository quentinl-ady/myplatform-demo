package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.PaymentInstrument;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.BalanceAccountInfoCustomer;
import com.myplatform.demo.model.BankAccountInformationResponse;
import com.myplatform.demo.model.KycStatus;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.BankingProvisioningService;
import com.myplatform.demo.service.LegalEntityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final UserRepository userRepository;
    private final BalanceAccountService balanceAccountService;
    private final BankingProvisioningService bankingProvisioningService;
    private final LegalEntityService legalEntityService;

    public AccountController(UserRepository userRepository,
                             BalanceAccountService balanceAccountService,
                             BankingProvisioningService bankingProvisioningService,
                             LegalEntityService legalEntityService) {
        this.userRepository = userRepository;
        this.balanceAccountService = balanceAccountService;
        this.bankingProvisioningService = bankingProvisioningService;
        this.legalEntityService = legalEntityService;
    }

    @GetMapping("/{userId}/balance")
    public ResponseEntity<List<BalanceAccountInfoCustomer>> getAllBalanceAccounts(@PathVariable Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no accountHolderId");
        }
        return ResponseEntity.ok(balanceAccountService.getBalanceAccounts(user.getAccountHolderId()));
    }

    @GetMapping("/balance/{balanceAccountId}")
    public ResponseEntity<BalanceAccountInfoCustomer> getBalanceAccount(@PathVariable String balanceAccountId) throws Exception {
        return ResponseEntity.ok(balanceAccountService.getOneBalanceAccount(balanceAccountId));
    }

    @GetMapping("/{userId}/bank")
    public ResponseEntity<BankAccountInformationResponse> getBankAccountInformation(@PathVariable Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        BankAccountInformationResponse response = balanceAccountService.getBankAccountInformation(user.getBankAccountId(), user.getCurrencyCode());
        response.setBankAccountNumber(user.getBankAccountNumber());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{userId}/bank/status")
    public ResponseEntity<Map<String, Object>> getBankAccountStatus(@PathVariable Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        Map<String, Object> result = new HashMap<>();
        result.put("bankingEnabled", Boolean.TRUE.equals(user.getBank()));
        result.put("bankAccountCreated", user.getBankAccountId() != null && !user.getBankAccountId().isBlank());
        result.put("bankAccountId", user.getBankAccountId());
        result.put("bankAccountNumber", user.getBankAccountNumber());

        boolean bankingAllowed = false;
        if (user.getLegalEntityId() != null && Boolean.TRUE.equals(user.getBank())) {
            try {
                KycStatus kycStatus = legalEntityService.getLegalEntityKycDetail(
                        user.getLegalEntityId(), user.getActivityReason(),
                        user.getBank(), user.getCapital(), user.getIssuing());
                if (kycStatus.getBankingStatus() != null) {
                    bankingAllowed = Boolean.TRUE.equals(kycStatus.getBankingStatus().getAllowed());
                }
            } catch (Exception ignored) {}
        }
        result.put("bankingAllowed", bankingAllowed);

        return ResponseEntity.ok(result);
    }

    @PostMapping("/{userId}/bank")
    public ResponseEntity<Map<String, String>> createBankAccount(@PathVariable Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (!Boolean.TRUE.equals(user.getBank())) {
            throw new BadRequestException("Banking is not enabled for this user");
        }
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        if (user.getBankAccountId() != null && !user.getBankAccountId().isBlank()) {
            throw new ConflictException("Bank account already exists");
        }

        provisionBankAccount(user);

        return ResponseEntity.ok(Map.of(
                "bankAccountId", user.getBankAccountId(),
                "bankAccountNumber", user.getBankAccountNumber()
        ));
    }

    private void provisionBankAccount(User user) throws Exception {
        String businessAccountBalanceAccountId = balanceAccountService.findBusinessBankBalanceAccountId(user.getAccountHolderId());

        if (businessAccountBalanceAccountId == null) {
            businessAccountBalanceAccountId = bankingProvisioningService.createBalanceForBusinessAccount(user.getCountryCode(), user.getAccountHolderId());
            bankingProvisioningService.createSweepAcquiringToBanking(user.getCountryCode(), businessAccountBalanceAccountId, user.getBalanceAccountId());
        }

        String paymentInstrumentBankAccount = bankingProvisioningService.createBankAccount(user.getCountryCode(), businessAccountBalanceAccountId);
        PaymentInstrument paymentInstrument = bankingProvisioningService.getPaymentInstrumentDetail(paymentInstrumentBankAccount);

        if ("US".equals(user.getCountryCode())) {
            user.setBankAccountNumber(paymentInstrument.getBankAccount().getAccountNumber() + " " + paymentInstrument.getBankAccount().getRoutingNumber());
        } else if ("FR".equals(user.getCountryCode()) || "NL".equals(user.getCountryCode())) {
            user.setBankAccountNumber(paymentInstrument.getBankAccount().getIban());
        } else if ("UK".equals(user.getCountryCode()) || "GB".equals(user.getCountryCode())) {
            user.setBankAccountNumber(paymentInstrument.getBankAccount().getAccountNumber() + " " + paymentInstrument.getBankAccount().getSortCode());
        }
        user.setBankAccountId(paymentInstrumentBankAccount);

        userRepository.save(user);
    }
}
