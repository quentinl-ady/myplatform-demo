package com.myplatform.demo.controller;

import com.myplatform.demo.dto.DTOMapper;
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
    public ResponseEntity<StoreCustomerDTO> createStore(@PathVariable Long userId, @RequestBody RequestStore requestStore) throws Exception {
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
                requestStore.getPaymentMethodRequest()
        );

        storeCustomer.setBalanceAccountInfoCustomer(balanceAccountService.getOneBalanceAccount(requestStore.getBalanceAccountId()));

        List<PaymentMethodCustomer> paymentMethodCustomer = storeManagementService.getAllPaymentMethod(storeCustomer.getStoreId());

        storeCustomer.setPaymentMethodCustomers(paymentMethodCustomer);
        storeCustomer.setUser(user);

        StoreCustomer savedStoreCustomer = storeCustomerRepository.save(storeCustomer);
        return ResponseEntity.ok(DTOMapper.toStoreCustomerDTO(savedStoreCustomer));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<StoreCustomerDTO>> getAllStores(@PathVariable Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        if (user.getStoresCustomer() == null) {
            throw new BadRequestException("User has no store");
        }

        List<StoreCustomer> stores = new ArrayList<>(user.getStoresCustomer());

        for (StoreCustomer storeCustomer : stores) {
            List<PaymentMethodCustomer> paymentMethods = storeManagementService.getAllPaymentMethod(storeCustomer.getStoreId());
            storeCustomer.getPaymentMethodCustomers().clear();
            for (PaymentMethodCustomer pm : paymentMethods) {
                pm.setStoreCustomer(storeCustomer);
                storeCustomer.getPaymentMethodCustomers().add(pm);
            }
        }
        storeCustomerRepository.saveAll(stores);

        List<StoreCustomerDTO> storeDTOs = stores.stream()
                .map(DTOMapper::toStoreCustomerDTO)
                .toList();

        return ResponseEntity.ok(storeDTOs);
    }

    @GetMapping("/{storeId}/terminals")
    public ResponseEntity<List<TerminalResponse>> listTerminals(@PathVariable String storeId) throws Exception {
        return ResponseEntity.ok(storeManagementService.listTerminals(storeId));
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
