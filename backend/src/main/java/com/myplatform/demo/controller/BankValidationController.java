package com.myplatform.demo.controller;

import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.CounterpartyVerificationResponse;
import com.myplatform.demo.model.IsBankAccountValidRequest;
import com.myplatform.demo.model.IsCrossBorderRequest;
import com.myplatform.demo.model.User;
import com.myplatform.demo.model.VerifyCounterpartyNameRequest;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BankValidationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/bank-validation")
public class BankValidationController {

    private final UserRepository userRepository;
    private final BankValidationService bankValidationService;

    public BankValidationController(UserRepository userRepository,
                                    BankValidationService bankValidationService) {
        this.userRepository = userRepository;
        this.bankValidationService = bankValidationService;
    }

    @GetMapping("/format/{countryCode}")
    public ResponseEntity<Map<String, String>> getBankAccountFormat(@PathVariable String countryCode) {
        String bankAccountFormat = bankValidationService.getBankAccountFormat(countryCode);
        return ResponseEntity.ok(Map.of("bankAccountFormat", bankAccountFormat));
    }

    @PostMapping("/cross-border")
    public ResponseEntity<Map<String, String>> isCrossBorder(@RequestBody IsCrossBorderRequest request) {
        User user = userRepository.findById(request.getUserId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Boolean isCrossBorder = bankValidationService.isCrossBorder(request.getCountryCodeCounterparty(), user.getCountryCode());
        return ResponseEntity.ok(Map.of("isCrossBorder", String.valueOf(isCrossBorder)));
    }

    @PostMapping("/validate")
    public ResponseEntity<Map<String, String>> isBankAccountValid(@RequestBody IsBankAccountValidRequest request) {
        try {
            bankValidationService.isBankAccountValid(request);
            return ResponseEntity.ok(Map.of("isBankAccountValid", "true"));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("isBankAccountValid", "false"));
        }
    }

    @PostMapping("/verify-counterparty")
    public ResponseEntity<CounterpartyVerificationResponse> verifyCounterpartyName(@RequestBody VerifyCounterpartyNameRequest request) throws Exception {
        return ResponseEntity.ok(bankValidationService.verifyCounterpartyName(request));
    }
}
