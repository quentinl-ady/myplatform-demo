package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.AssociationFinaliseResponse;
import com.adyen.model.balanceplatform.AssociationInitiateResponse;
import com.adyen.model.balanceplatform.Device;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.adyen.model.balanceplatform.RegisterSCAResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.BankTransferService;
import com.myplatform.demo.service.OtpService;
import com.myplatform.demo.service.TransferService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/transfers")
public class TransferController {

    private static final Logger log = LoggerFactory.getLogger(TransferController.class);

    private final UserRepository userRepository;
    private final TransferService transferService;
    private final BankTransferService bankTransferService;
    private final BalanceAccountService balanceAccountService;
    private final OtpService otpService;

    public TransferController(UserRepository userRepository,
                              TransferService transferService,
                              BankTransferService bankTransferService,
                              BalanceAccountService balanceAccountService,
                              OtpService otpService) {
        this.userRepository = userRepository;
        this.transferService = transferService;
        this.bankTransferService = bankTransferService;
        this.balanceAccountService = balanceAccountService;
        this.otpService = otpService;
    }

    @GetMapping("/{userId}/devices")
    public ResponseEntity<List<Device>> listDevices(@PathVariable String userId) throws Exception {
        User user = findUser(userId);
        return ResponseEntity.ok(transferService.getListDevices(resolvePhysicalPi(user)));
    }

    @PostMapping("/devices/otp")
    public ResponseEntity<Map<String, String>> requestOtp(@RequestBody Map<String, String> payload) {
        String userId = payload.get("userId");
        User user = findUser(userId);
        String code = otpService.generateOtp(userId);
        String email = user.getEmail();
        String maskedEmail = maskEmail(email);
        return ResponseEntity.ok(Map.of("otp", code, "maskedEmail", maskedEmail));
    }

    @PostMapping("/devices/register")
    public ResponseEntity<?> initiateDeviceRegistration(@RequestBody InitiateDeviceRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());

        if (request.getOtpCode() == null || !otpService.verifyOtp(request.getUserId(), request.getOtpCode())) {
            return ResponseEntity.status(403).body(Map.of("error", "Invalid or expired OTP code"));
        }

        return ResponseEntity.ok(transferService.registerDevice(request.getSdkOutput(), resolvePhysicalPi(user), request.getDeviceName()));
    }

    @PostMapping("/devices/register/finalize")
    public ResponseEntity<RegisterSCAFinalResponse> finalizeRegistration(@RequestBody FinalizeRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        return ResponseEntity.ok(transferService.finalizeRegistration(request.getId(), request.getSdkOutput(), resolvePhysicalPi(user)));
    }

    @PostMapping("/devices/associate")
    public ResponseEntity<Map<String, Object>> initiateDeviceAssociation(@RequestBody Map<String, String> payload) throws Exception {
        String userId = payload.get("userId");
        String deviceId = payload.get("deviceId");
        User user = findUser(userId);

        String virtualPi = resolveVirtualPi(user);
        if (virtualPi == null) {
            return ResponseEntity.ok(Map.of("associationRequired", false));
        }

        AssociationInitiateResponse response = transferService.initiateDeviceAssociation(deviceId, List.of(virtualPi));
        return ResponseEntity.ok(Map.of(
                "associationRequired", true,
                "sdkInput", response.getSdkInput(),
                "virtualPiId", virtualPi
        ));
    }

    @PostMapping("/devices/associate/finalize")
    public ResponseEntity<Map<String, Object>> finalizeDeviceAssociation(@RequestBody Map<String, String> payload) throws Exception {
        String userId = payload.get("userId");
        String deviceId = payload.get("deviceId");
        String sdkOutput = payload.get("sdkOutput");
        String virtualPiId = payload.get("virtualPiId");
        findUser(userId);

        AssociationFinaliseResponse response = transferService.finalizeDeviceAssociation(deviceId, List.of(virtualPiId), sdkOutput);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/devices/delete")
    public ResponseEntity<Map<String, String>> deleteDevice(@RequestBody DeleteDeviceRequest request) throws Exception {
        transferService.deleteDevice(request.getId(), request.getPaymentInstrumentId());

        try {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(request.getPaymentInstrumentId());
            if (baId != null) {
                String virtualPi = balanceAccountService.getVirtualBankAccountId(baId);
                if (virtualPi != null) {
                    transferService.deleteDeviceAssociation(request.getId(), virtualPi);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to clean up virtual PI association on device delete: {}", e.getMessage());
        }

        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/initiate")
    public ResponseEntity<InitiateTransferResponse> initiateTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());

        try {
            InitiateTransferResponse response = transferService.initiateTransfer(request, resolveTransferPi(user));
            return ResponseEntity.ok(response);
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode().value() != 401) {
                throw e;
            }

            HttpHeaders errorHeaders = e.getResponseHeaders();

            InitiateTransferResponse res = new InitiateTransferResponse();

            if (errorHeaders != null) {
                String wwwAuth = errorHeaders.getFirst("WWW-Authenticate");
                if (wwwAuth != null) {
                    Pattern pattern = Pattern.compile("auth-param1=\"([^\"]+)\"");
                    Matcher matcher = pattern.matcher(wwwAuth);
                    if (matcher.find()) {
                        res.setAuthParam1(matcher.group(1));
                    }
                }
            }

            transferService.populateCounterpartyDetails(res, request);
            res.setAmount(request.getAmount());
            res.setCounterpartyCountry(request.getCounterpartyCountry());
            return ResponseEntity.ok(res);
        }
    }

    @PostMapping("/finalize")
    public ResponseEntity<Map<String, String>> finalizeTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());
        transferService.finalizeTransfer(request, resolveTransferPi(user));
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/batch/initiate")
    public ResponseEntity<Map<String, Object>> initiateBatchTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());
        Map<String, Object> result = transferService.initiateBatchTransfer(request, resolveTransferPi(user), user.getAccountHolderId());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/batch/approve")
    public ResponseEntity<Map<String, Object>> approveTransfers(@RequestBody Map<String, Object> payload) throws Exception {
        String userId = (String) payload.get("userId");
        @SuppressWarnings("unchecked")
        List<String> transferIds = (List<String>) payload.get("transferIds");
        String sdkOutput = (String) payload.get("sdkOutput");
        findUser(userId);

        try {
            Map<String, Object> result = transferService.approveTransfers(transferIds, sdkOutput);
            return ResponseEntity.ok(result);
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode().value() == 422 && e.getResponseBodyAsString().contains("Transfer not found")) {
                Map<String, Object> res = new HashMap<>();
                res.put("status", "transfers_not_ready");
                res.put("message", "Some transfers are not yet propagated. Please wait 1 minute and try again.");
                return ResponseEntity.ok(res);
            }
            if (e.getStatusCode().value() != 401) {
                throw e;
            }

            HttpHeaders errorHeaders = e.getResponseHeaders();
            Map<String, Object> res = new HashMap<>();

            if (errorHeaders != null) {
                String wwwAuth = errorHeaders.getFirst("WWW-Authenticate");
                if (wwwAuth != null) {
                    Pattern pattern = Pattern.compile("auth-param1=\"([^\"]+)\"");
                    Matcher matcher = pattern.matcher(wwwAuth);
                    if (matcher.find()) {
                        res.put("authParam1", matcher.group(1));
                    }
                }
            }

            res.put("status", "sca_required");
            return ResponseEntity.ok(res);
        }
    }

    @PostMapping("/batch/approve/finalize")
    public ResponseEntity<Map<String, Object>> finalizeApproval(@RequestBody Map<String, Object> payload) throws Exception {
        String userId = (String) payload.get("userId");
        @SuppressWarnings("unchecked")
        List<String> transferIds = (List<String>) payload.get("transferIds");
        String sdkOutput = (String) payload.get("sdkOutput");
        findUser(userId);

        Map<String, Object> result = transferService.approveTransfers(transferIds, sdkOutput);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/batch/pending")
    public ResponseEntity<Map<String, Object>> getPendingTransfers(@RequestParam String userId) throws Exception {
        User user = findUser(userId);
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        return ResponseEntity.ok(transferService.getPendingTransfers(user.getAccountHolderId()));
    }

    @PostMapping("/{userId}/bank-transactions/initiate")
    public ResponseEntity<Map<String, Object>> initiateBankTransactions(@PathVariable String userId,
                                                                        @RequestBody Map<String, Object> payload) throws Exception {
        User user = findUser(userId);
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        String sdkOutput = (String) payload.get("sdkOutput");
        String balanceAccountId = user.getBankAccountId() != null
                ? balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId())
                : null;
        return ResponseEntity.ok(bankTransferService.initiateBankTransfers(
                user.getAccountHolderId(), balanceAccountId, sdkOutput));
    }

    @PostMapping("/{userId}/bank-transactions/finalize")
    public ResponseEntity<Map<String, Object>> finalizeBankTransactions(@PathVariable String userId,
                                                                        @RequestBody Map<String, Object> payload) throws Exception {
        User user = findUser(userId);
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        String sdkOutput = (String) payload.get("sdkOutput");
        String createdSince = (String) payload.get("createdSince");
        String createdUntil = (String) payload.get("createdUntil");
        String balanceAccountId = user.getBankAccountId() != null
                ? balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId())
                : null;
        return ResponseEntity.ok(bankTransferService.finalizeBankTransfers(
                user.getAccountHolderId(), balanceAccountId, sdkOutput, createdSince, createdUntil));
    }

    @GetMapping("/{userId}/bank-transactions/detail/{transferId}")
    public ResponseEntity<com.myplatform.demo.dto.BankTransferDTO> getTransferDetail(
            @PathVariable String userId,
            @PathVariable String transferId) {
        findUser(userId); // validate user exists
        return ResponseEntity.ok(bankTransferService.getTransferDetail(transferId));
    }

    private String resolvePhysicalPi(User user) throws Exception {
        if (user.getBankAccountId() != null) {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
            if (baId != null) {
                String physicalPi = balanceAccountService.getPhysicalBankAccountId(baId);
                if (physicalPi != null) {
                    return physicalPi;
                }
            }
        }
        return user.getBankAccountId();
    }

    private String resolveVirtualPi(User user) throws Exception {
        if (user.getBankAccountId() != null) {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
            if (baId != null) {
                return balanceAccountService.getVirtualBankAccountId(baId);
            }
        }
        return null;
    }

    private String resolveTransferPi(User user) throws Exception {
        if (user.getBankAccountId() != null) {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
            if (baId != null) {
                String virtualPi = balanceAccountService.getVirtualBankAccountId(baId);
                if (virtualPi != null) {
                    return virtualPi;
                }
                String physicalPi = balanceAccountService.getPhysicalBankAccountId(baId);
                if (physicalPi != null) {
                    return physicalPi;
                }
            }
        }
        return user.getBankAccountId();
    }

    private User findUser(String userId) {
        ApiLogContext.setUserId(userId);
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private String maskEmail(String email) {
        if (email == null || !email.contains("@")) return "***";
        String[] parts = email.split("@");
        String local = parts[0];
        String masked = local.length() <= 2 ? local.charAt(0) + "***" : local.substring(0, 2) + "***";
        return masked + "@" + parts[1];
    }
}
