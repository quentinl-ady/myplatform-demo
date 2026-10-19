package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.AssociationInitiateResponse;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.TrustedDeviceDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BankAccountResolver;
import com.myplatform.demo.service.BankTransferService;
import com.myplatform.demo.service.OtpService;
import com.myplatform.demo.service.TransferRouteService;
import com.myplatform.demo.service.TransferService;
import com.myplatform.demo.service.TrustedDeviceService;
import com.myplatform.demo.util.EmailMask;
import com.myplatform.demo.util.RecipientCountries;
import com.myplatform.demo.util.ScaChallenges;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/transfers")
public class TransferController {

    public static final String NO_BANK_ACCOUNT_MESSAGE = "No business bank account has been created yet.";

    private final UserRepository userRepository;
    private final TransferService transferService;
    private final TransferRouteService transferRouteService;
    private final BankTransferService bankTransferService;
    private final BankAccountResolver bankAccounts;
    private final TrustedDeviceService trustedDevices;
    private final OtpService otpService;

    public TransferController(UserRepository userRepository,
                              TransferService transferService,
                              TransferRouteService transferRouteService,
                              BankTransferService bankTransferService,
                              BankAccountResolver bankAccounts,
                              TrustedDeviceService trustedDevices,
                              OtpService otpService) {
        this.userRepository = userRepository;
        this.transferService = transferService;
        this.transferRouteService = transferRouteService;
        this.bankTransferService = bankTransferService;
        this.bankAccounts = bankAccounts;
        this.trustedDevices = trustedDevices;
        this.otpService = otpService;
    }

    @GetMapping("/{userId}/devices")
    public ResponseEntity<List<TrustedDeviceDTO>> listDevices(@PathVariable String userId) throws Exception {
        User user = findUser(userId);
        if (!bankAccounts.hasBankAccount(user)) {
            throw new ResourceNotFoundException(NO_BANK_ACCOUNT_MESSAGE);
        }
        return ResponseEntity.ok(trustedDevices.list(user.getId(), bankAccounts.physicalPi(user)));
    }

    @GetMapping("/{userId}/recipient-countries")
    public ResponseEntity<List<RecipientCountry>> getRecipientCountries(@PathVariable String userId) {
        User user = findUser(userId);
        return ResponseEntity.ok(RecipientCountries.forAccountCurrency(user.getCurrencyCode()));
    }

    @PostMapping("/{userId}/transfer-routes")
    public ResponseEntity<List<TransferRouteOption>> calculateTransferRoutes(@PathVariable String userId,
                                                                             @RequestBody TransferRequest beneficiary) throws Exception {
        User user = findUser(userId);
        RecipientCountry recipientCountry = RecipientCountries.require(user.getCurrencyCode(), beneficiary.getCounterpartyCountry());
        return ResponseEntity.ok(transferRouteService.calculateRoutes(bankAccounts.balanceAccountId(user), recipientCountry, beneficiary));
    }

    @PostMapping("/devices/otp")
    public ResponseEntity<Map<String, String>> requestOtp(@RequestBody Map<String, String> payload) {
        String userId = payload.get("userId");
        User user = findUser(userId);
        String code = otpService.generateOtp(userId);
        return ResponseEntity.ok(Map.of("otp", code, "maskedEmail", EmailMask.mask(user.getEmail())));
    }

    @PostMapping("/devices/register")
    public ResponseEntity<?> initiateDeviceRegistration(@RequestBody InitiateDeviceRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        if (!bankAccounts.hasBankAccount(user)) {
            throw new BadRequestException(NO_BANK_ACCOUNT_MESSAGE);
        }

        if (request.getOtpCode() == null || !otpService.verifyOtp(request.getUserId(), request.getOtpCode())) {
            return ResponseEntity.status(403).body(Map.of("error", "Invalid or expired OTP code"));
        }

        return ResponseEntity.ok(trustedDevices.initiateRegistration(bankAccounts.physicalPi(user),
                request.getSdkOutput(), request.getDeviceName()));
    }

    @PostMapping("/devices/register/finalize")
    public ResponseEntity<RegisterSCAFinalResponse> finalizeRegistration(@RequestBody FinalizeRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        if (!bankAccounts.hasBankAccount(user)) {
            throw new BadRequestException(NO_BANK_ACCOUNT_MESSAGE);
        }
        return ResponseEntity.ok(trustedDevices.finalizeRegistration(user.getId(), bankAccounts.physicalPi(user),
                request.getId(), request.getSdkOutput(), request.getKind(), request.getPlatform()));
    }

    @PostMapping("/devices/associate")
    public ResponseEntity<Map<String, Object>> initiateDeviceAssociation(@RequestBody Map<String, String> payload) throws Exception {
        String userId = payload.get("userId");
        String deviceId = payload.get("deviceId");
        User user = findUser(userId);

        String virtualPi = bankAccounts.virtualPi(user);
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

        transferService.finalizeDeviceAssociation(deviceId, List.of(virtualPiId), sdkOutput);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/devices/delete")
    public ResponseEntity<Map<String, String>> deleteDevice(@RequestBody DeleteDeviceRequest request) throws Exception {
        trustedDevices.delete(request.getId(), request.getPaymentInstrumentId());
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/initiate")
    public ResponseEntity<InitiateTransferResponse> initiateTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());
        RecipientCountry recipientCountry = RecipientCountries.require(user.getCurrencyCode(), request.getCounterpartyCountry());
        transferRouteService.requireEligible(bankAccounts.balanceAccountId(user), recipientCountry, request);

        try {
            InitiateTransferResponse response = transferService.initiateTransfer(request, bankAccounts.transferPi(user), recipientCountry);
            return ResponseEntity.ok(response);
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode().value() != 401) {
                throw e;
            }

            InitiateTransferResponse res = new InitiateTransferResponse();
            res.setAuthParam1(ScaChallenges.authParam1(e));
            transferService.populateCounterpartyDetails(res, request, recipientCountry);
            res.setAmount(request.getAmount());
            res.setCounterpartyCountry(request.getCounterpartyCountry());
            return ResponseEntity.ok(res);
        }
    }

    @PostMapping("/finalize")
    public ResponseEntity<Map<String, String>> finalizeTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());
        RecipientCountry recipientCountry = RecipientCountries.require(user.getCurrencyCode(), request.getCounterpartyCountry());
        transferService.finalizeTransfer(request, bankAccounts.transferPi(user), recipientCountry);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/batch/initiate")
    public ResponseEntity<Map<String, Object>> initiateBatchTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());
        RecipientCountry recipientCountry = RecipientCountries.require(user.getCurrencyCode(), request.getCounterpartyCountry());
        transferRouteService.requireEligible(bankAccounts.balanceAccountId(user), recipientCountry, request);
        Map<String, Object> result = transferService.initiateBatchTransfer(request, bankAccounts.transferPi(user), user.getAccountHolderId(), recipientCountry);
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

            Map<String, Object> res = new HashMap<>();
            String authParam1 = ScaChallenges.authParam1(e);
            if (authParam1 != null) {
                res.put("authParam1", authParam1);
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

    @PostMapping("/batch/cancel")
    public ResponseEntity<Map<String, Object>> cancelBatchTransfers(@RequestBody Map<String, Object> payload) {
        String userId = (String) payload.get("userId");
        if (userId == null || userId.isBlank()) {
            throw new BadRequestException("userId is required");
        }
        User user = findUser(userId);
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }

        Object rawIds = payload.get("transferIds");
        List<String> transferIds = new ArrayList<>();
        if (rawIds instanceof List<?> ids) {
            for (Object id : ids) {
                if (id instanceof String s && !s.isBlank()) {
                    transferIds.add(s);
                }
            }
        }
        if (transferIds.isEmpty()) {
            throw new BadRequestException("Select at least one transfer to cancel");
        }

        return ResponseEntity.ok(transferService.cancelTransfers(user.getAccountHolderId(), transferIds));
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
        String balanceAccountId = user.getBankAccountId() != null ? bankAccounts.balanceAccountId(user) : null;
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
        String balanceAccountId = user.getBankAccountId() != null ? bankAccounts.balanceAccountId(user) : null;
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

    private User findUser(String userId) {
        ApiLogContext.setUserId(userId);
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
