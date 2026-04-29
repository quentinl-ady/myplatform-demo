package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.Device;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.adyen.model.balanceplatform.RegisterSCAResponse;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.UserRepository;
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

    public TransferController(UserRepository userRepository,
                              TransferService transferService) {
        this.userRepository = userRepository;
        this.transferService = transferService;
    }

    @GetMapping("/{userId}/devices")
    public ResponseEntity<List<Device>> listDevices(@PathVariable Long userId) throws Exception {
        User user = findUser(userId);
        return ResponseEntity.ok(transferService.getListDevices(user.getBankAccountId()));
    }

    @PostMapping("/devices/register")
    public ResponseEntity<RegisterSCAResponse> initiateDeviceRegistration(@RequestBody InitiateDeviceRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        return ResponseEntity.ok(transferService.registerDevice(request.getSdkOutput(), user.getBankAccountId()));
    }

    @PostMapping("/devices/register/finalize")
    public ResponseEntity<RegisterSCAFinalResponse> finalizeRegistration(@RequestBody FinalizeRegistrationRequest request) throws Exception {
        User user = findUser(request.getUserId());
        return ResponseEntity.ok(transferService.finalizeRegistration(request.getId(), request.getSdkOutput(), user.getBankAccountId()));
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
            InitiateTransferResponse response = transferService.initiateTransfer(request, user.getBankAccountId());
            return ResponseEntity.ok(response);
        } catch (HttpClientErrorException e) {
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
        transferService.finalizeTransfer(request, user.getBankAccountId());
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    private User findUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
