package com.myplatform.demo.controller;

import com.myplatform.demo.dto.DTOMapper;
import com.myplatform.demo.dto.PaymentMethodCustomerDTO;
import com.myplatform.demo.dto.StoreCustomerDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.StoreManagementService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/stores")
public class StoreController {

    private final UserRepository userRepository;
    private final StoreCustomerRepository storeCustomerRepository;
    private final StoreManagementService storeManagementService;
    private final BalanceAccountService balanceAccountService;

    public StoreController(UserRepository userRepository,
                           StoreCustomerRepository storeCustomerRepository,
                           StoreManagementService storeManagementService,
                           BalanceAccountService balanceAccountService) {
        this.userRepository = userRepository;
        this.storeCustomerRepository = storeCustomerRepository;
        this.storeManagementService = storeManagementService;
        this.balanceAccountService = balanceAccountService;
    }

    @PostMapping("/{userId}")
    public ResponseEntity<StoreCustomerDTO> createStore(@PathVariable String userId, @RequestBody RequestStore requestStore) throws Exception {
        User user = findUserWithLegalEntity(userId);

        StoreCustomer storeCustomer = storeManagementService.createStore(
                user.getLegalEntityId(),
                requestStore.getBusinessLineId(),
                requestStore.getCity(),
                requestStore.getCountry(),
                requestStore.getPostalCode(),
                requestStore.getLineAdresse1(),
                requestStore.getReference(),
                user.getLegalEntityName(),
                requestStore.getPhoneNumber(),
                requestStore.getBalanceAccountId(),
                requestStore.getPaymentMethodRequest(),
                user.getEmail()
        );

        storeCustomer.setBalanceAccountInfoCustomer(balanceAccountService.getOneBalanceAccount(requestStore.getBalanceAccountId()));

        List<PaymentMethodCustomer> paymentMethodCustomer = storeManagementService.getAllPaymentMethod(storeCustomer.getStoreId());

        storeCustomer.setPaymentMethodCustomers(paymentMethodCustomer);
        storeCustomer.setUser(user);

        StoreCustomer savedStoreCustomer = storeCustomerRepository.save(storeCustomer);
        return ResponseEntity.ok(DTOMapper.toStoreCustomerDTO(savedStoreCustomer));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<StoreCustomerDTO>> getAllStores(@PathVariable String userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        if (user.getStoresCustomer() == null) {
            throw new BadRequestException("User has no store");
        }

        List<StoreCustomer> stores = new ArrayList<>(user.getStoresCustomer());

        List<StoreCustomerDTO> storeDTOs = new ArrayList<>();
        for (StoreCustomer storeCustomer : stores) {
            StoreCustomerDTO dto = DTOMapper.toStoreCustomerDTO(storeCustomer);

            List<PaymentMethodCustomer> livePMs = storeManagementService.getAllPaymentMethod(storeCustomer.getStoreId());
            List<PaymentMethodCustomerDTO> pmDTOs = livePMs.stream()
                    .map(pm -> {
                        PaymentMethodCustomerDTO pmDTO = new PaymentMethodCustomerDTO();
                        pmDTO.setType(pm.getType());
                        pmDTO.setVerificationStatus(pm.getVerificationStatus());
                        pmDTO.setPaymentMethodId(pm.getPaymentMethodId());
                        pmDTO.setEnabled(pm.getEnabled());
                        return pmDTO;
                    })
                    .toList();
            dto.setPaymentMethods(pmDTOs);

            storeDTOs.add(dto);
        }

        return ResponseEntity.ok(storeDTOs);
    }

    @PostMapping("/{userId}/{storeId}/paymentMethods")
    public ResponseEntity<List<PaymentMethodCustomerDTO>> addPaymentMethods(
            @PathVariable String userId,
            @PathVariable String storeId,
            @RequestBody List<String> paymentMethods) throws Exception {

        User user = findUserWithLegalEntity(userId);

        StoreCustomer storeCustomer = storeCustomerRepository.findByStoreId(storeId)
                .orElseThrow(() -> new ResourceNotFoundException("Store not found"));

        storeManagementService.requestPaymentMethodForExistingStore(
                paymentMethods,
                storeId,
                user.getCountryCode(),
                user.getEmail()
        );

        List<PaymentMethodCustomer> updatedPMs = storeManagementService.getAllPaymentMethod(storeId);
        storeCustomer.getPaymentMethodCustomers().clear();
        for (PaymentMethodCustomer pm : updatedPMs) {
            pm.setStoreCustomer(storeCustomer);
            storeCustomer.getPaymentMethodCustomers().add(pm);
        }
        storeCustomerRepository.save(storeCustomer);

        List<PaymentMethodCustomerDTO> pmDTOs = updatedPMs.stream()
                .map(pm -> {
                    PaymentMethodCustomerDTO dto = new PaymentMethodCustomerDTO();
                    dto.setType(pm.getType());
                    dto.setVerificationStatus(pm.getVerificationStatus());
                    dto.setPaymentMethodId(pm.getPaymentMethodId());
                    dto.setEnabled(pm.getEnabled());
                    return dto;
                })
                .toList();

        return ResponseEntity.ok(pmDTOs);
    }

    @PatchMapping("/paymentMethods/{paymentMethodId}")
    public ResponseEntity<PaymentMethodCustomerDTO> togglePaymentMethod(
            @PathVariable String paymentMethodId,
            @RequestBody Map<String, Boolean> body) throws Exception {

        boolean enabled = body.getOrDefault("enabled", true);
        PaymentMethodCustomer updated = storeManagementService.togglePaymentMethod(paymentMethodId, enabled);

        PaymentMethodCustomerDTO dto = new PaymentMethodCustomerDTO();
        dto.setType(updated.getType());
        dto.setVerificationStatus(updated.getVerificationStatus());
        dto.setPaymentMethodId(updated.getPaymentMethodId());
        dto.setEnabled(updated.getEnabled());
        return ResponseEntity.ok(dto);
    }

    @GetMapping("/{storeId}/terminals")
    public ResponseEntity<List<TerminalResponse>> listTerminals(@PathVariable String storeId) throws Exception {
        return ResponseEntity.ok(storeManagementService.listTerminals(storeId));
    }

    private User findUserWithLegalEntity(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }
        return user;
    }
}
