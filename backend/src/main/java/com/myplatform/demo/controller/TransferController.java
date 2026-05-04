package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.Device;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.adyen.model.balanceplatform.RegisterSCAResponse;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.BankTransferService;
import com.myplatform.demo.service.TransferService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/transfers")
public class TransferController {

    private final UserRepository userRepository;
    private final TransferService transferService;
    private final BankTransferService bankTransferService;
    private final BalanceAccountService balanceAccountService;

    public TransferController(UserRepository userRepository,
                              TransferService transferService,
                              BankTransferService bankTransferService,
                              BalanceAccountService balanceAccountService) {
        this.userRepository = userRepository;
        this.transferService = transferService;
        this.bankTransferService = bankTransferService;
        this.balanceAccountService = balanceAccountService;
    }

    @GetMapping("/{userId}/devices")
    public ResponseEntity<List<Device>> listDevices(@PathVariable Long userId) throws Exception {
        User user = findUser(userId);
        return ResponseEntity.ok(transferService.getListDevices(resolvePhysicalPi(user)));
    }

    @PostMapping("/devices/register")
    public ResponseEntity<RegisterSCAResponse> initiateDeviceRegistration(@RequestBody InitiateDeviceRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        return ResponseEntity.ok(transferService.registerDevice(request.getSdkOutput(), resolvePhysicalPi(user), request.getDeviceName()));
    }

    @PostMapping("/devices/register/finalize")
    public ResponseEntity<RegisterSCAFinalResponse> finalizeRegistration(@RequestBody FinalizeRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        return ResponseEntity.ok(transferService.finalizeRegistration(request.getId(), request.getSdkOutput(), resolvePhysicalPi(user)));
    }

    @PostMapping("/devices/delete")
    public ResponseEntity<Map<String, String>> deleteDevice(@RequestBody DeleteDeviceRequest request) throws Exception {
        transferService.deleteDevice(request.getId(), request.getPaymentInstrumentId());
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/initiate")
    public ResponseEntity<InitiateTransferResponse> initiateTransfer(@RequestBody TransferRequest request) throws Exception {
        User user = findUser(request.getUserId());

        try {
            InitiateTransferResponse response = transferService.initiateTransfer(request, resolvePhysicalPi(user));
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
        transferService.finalizeTransfer(request, resolvePhysicalPi(user));
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/{userId}/bank-transactions/initiate")
    public ResponseEntity<Map<String, Object>> initiateBankTransactions(@PathVariable Long userId,
                                                                        @RequestBody Map<String, Object> payload) throws Exception {
        User user = findUser(userId);
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        String sdkOutput = (String) payload.get("sdkOutput");
        String paymentInstrumentId = resolvePhysicalPi(user);
        return ResponseEntity.ok(bankTransferService.initiateBankTransfers(
                user.getAccountHolderId(), paymentInstrumentId, sdkOutput));
    }

    @PostMapping("/{userId}/bank-transactions/finalize")
    public ResponseEntity<Map<String, Object>> finalizeBankTransactions(@PathVariable Long userId,
                                                                        @RequestBody Map<String, Object> payload) throws Exception {
        User user = findUser(userId);
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        String sdkOutput = (String) payload.get("sdkOutput");
        String createdSince = (String) payload.get("createdSince");
        String createdUntil = (String) payload.get("createdUntil");
        String paymentInstrumentId = resolvePhysicalPi(user);
        return ResponseEntity.ok(bankTransferService.finalizeBankTransfers(
                user.getAccountHolderId(), paymentInstrumentId, sdkOutput, createdSince, createdUntil));
    }

    @GetMapping("/{userId}/bank-transactions/detail/{transferId}")
    public ResponseEntity<com.myplatform.demo.dto.BankTransferDTO> getTransferDetail(
            @PathVariable Long userId,
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

    private User findUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
