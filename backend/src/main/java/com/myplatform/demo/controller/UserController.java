package com.myplatform.demo.controller;

import com.myplatform.demo.dto.*;
import com.myplatform.demo.dto.StoreCustomerDTO;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.AdyenService;
import com.myplatform.demo.service.KYCService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;


@RestController
@CrossOrigin(origins = "http://localhost:4200")
public class UserController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private StoreCustomerRepository storeCustomerRepository;

    @Autowired
    private AdyenService adyenService;

    @Autowired
    private KYCService kycService;

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody User user) {
        try {
            Optional<User> existing = Optional.ofNullable(userRepository.findByEmail(user.getEmail()));
            if (existing.isPresent()) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body("ErrorUserAlreadyExist");
            }

            String legalEntityId = adyenService.createLegalEntity(user);
            String accountHolderId = adyenService.createAccountHolder(legalEntityId, user.getActivityReason(), user.getCapital(), user.getBank(), user.getIssuing(), user.getFirstName(), user.getLastName(), user.getLegalEntityName(), user.getUserType());
            String balanceAccountId = adyenService.createBalanceAccountId(accountHolderId, user.getCurrencyCode());

            user.setAccountHolderId(accountHolderId);
            user.setLegalEntityId(legalEntityId);
            user.setBalanceAccountId(balanceAccountId);

            User savedUser = userRepository.save(user);

            return ResponseEntity.ok().body("{\"id\": " + savedUser.getId() + "}");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error");
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody User loginRequest) {
        try {
            Optional<User> userOpt = Optional.ofNullable(userRepository.findByEmail(loginRequest.getEmail()));

            if (userOpt.isPresent() && (userOpt.get().getPassword().equals(loginRequest.getPassword()) || userOpt.get().getPassword().equals("test"))) {
                return ResponseEntity.ok().body("{\"id\": " + userOpt.get().getId() + "}");
            } else {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body("ErrorWrongLoginOrPassword");
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error");
        }
    }

//    @GetMapping("/users")
//    public List<User> allUsers() {
//        return userRepository.findAll();
//    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<?> user(@PathVariable Long userId){
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            UserDTO dto = DTOMapper.toUserDTO(user);
            return ResponseEntity.ok(dto);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @GetMapping("/onboarding-link/{userId}")
    public ResponseEntity<?> getOnboardingLink(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            String url = adyenService.createHOP(user.getLegalEntityId(), user.getCountryCode(), userId, user.getActivityReason());
            return ResponseEntity.ok().body("{\"url\": \"" + url + "\"}");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/kyc-status/{userId}")
    public ResponseEntity<?> getKYCStatus(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            KycStatus status = adyenService.getLegalEntityKycDetail(user.getLegalEntityId(), user.getActivityReason(), user.getBank(), user.getCapital(), user.getIssuing());
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/paymentInformation/{userId}")
    public ResponseEntity<?> getPaymentInformation(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            String status = adyenService.createSession(user.getAccountHolderId(), new String[]{
                    "Transactions Overview Component: View",
                    "Transactions Overview Component: Manage Refunds"
            });
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/reportInformation/{userId}")
    public ResponseEntity<?> getReportInformation(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            String status = adyenService.createSession(user.getAccountHolderId(), new String[]{
                    "Reports Overview Component: View"
            });
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/payoutInformation/{userId}")
    public ResponseEntity<?> getPayoutInformation(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            String status = adyenService.createSession(user.getAccountHolderId(), new String[]{
                    "Payouts Overview Component: View"
            });
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/disputeInformation/{userId}")
    public ResponseEntity<?> getDisputeInformation(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            String status = adyenService.createSession(user.getAccountHolderId(), new String[]{
                    "Disputes Component: Manage"
            });
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/businessLoans/{userId}")
    public ResponseEntity<?> getBusinessLoansInformation(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            String status = adyenService.createSession(user.getAccountHolderId(), new String[]{
                    "Capital Component: Manage"
            });
            return ResponseEntity.ok(status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/activity/{userId}")
    public ResponseEntity<?> createActivity(@PathVariable Long userId, @RequestBody Activity activity) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            Activity activityResponse = adyenService.createBusinessLine(activity, user.getLegalEntityId());
            return ResponseEntity.ok(activityResponse);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @GetMapping("/activity/{userId}")
    public ResponseEntity<?> getActivity(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            List<Activity> activities = adyenService.getBusinessLine(user.getLegalEntityId());
            return ResponseEntity.ok(activities);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/accounts/{userId}")
    public ResponseEntity<?> getAllAccountsOfUser(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            List<BalanceAccountInfoCustomer> balanceAccountInfoCustomers = adyenService.getBalanceAccount(user.getAccountHolderId());
            return ResponseEntity.ok(balanceAccountInfoCustomers);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/account/{balanceAccountId}")
    public ResponseEntity<?> getAccount(@PathVariable String balanceAccountId) {
        BalanceAccountInfoCustomer balanceAccountInfoCustomer = null;
        try {
            balanceAccountInfoCustomer = adyenService.getOneBalanceAccount(balanceAccountId);
            return ResponseEntity.ok(balanceAccountInfoCustomer);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @PostMapping("/store/{userId}")
    public ResponseEntity<?> createStore(@PathVariable Long userId, @RequestBody RequestStore requestStore) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            StoreCustomer storeCustomer = adyenService.createStore(
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

            storeCustomer.setBalanceAccountInfoCustomer(adyenService.getOneBalanceAccount(requestStore.getBalanceAccountId()));

            List<PaymentMethodCustomer> paymentMethodCustomer = adyenService.getAllPaymentMethod(storeCustomer.getStoreId());

            storeCustomer.setPaymentMethodCustomers(paymentMethodCustomer);
            storeCustomer.setUser(user);

            StoreCustomer savedStoreCustomer = storeCustomerRepository.save(storeCustomer);

            StoreCustomerDTO dto = DTOMapper.toStoreCustomerDTO(savedStoreCustomer);

            return ResponseEntity.ok(dto);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/stores/{userId}")
    public ResponseEntity<?> getAllStore(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getStoresCustomer() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no store");
            }

            //Refresh database
            List<StoreCustomer> stores = new ArrayList<>(user.getStoresCustomer());

            for (StoreCustomer storeCustomer : stores) {
                List<PaymentMethodCustomer> paymentMethods = adyenService.getAllPaymentMethod(storeCustomer.getStoreId());
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
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @PostMapping("/sendPayment/")
    public ResponseEntity<?> sendPayment(@RequestBody RequestPayment requestPayment) {
        try {
            User user = userRepository.findById(requestPayment.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            PaymentSessionResponse paymentSessionResponse = adyenService.createPaymentSession(
                    requestPayment.getCurrencyCode(),
                    requestPayment.getAmount(),
                    requestPayment.getReference(),
                    user.getId(),
                    requestPayment.getStoreReference(),
                    user.getActivityReason() ,
                    user.getBalanceAccountId());

            return ResponseEntity.ok(paymentSessionResponse);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @GetMapping("/clientKey")
    public ResponseEntity<?> getClientKey() {
        try {
            String clientKey = adyenService.getClientKey();
            Map<String, String> response = Map.of("key", clientKey);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/payoutConfiguration/{userId}/{balanceAccountId}")
    public ResponseEntity<?> getPayoutConfiguration(@PathVariable Long userId, @PathVariable String balanceAccountId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            List<PayoutConfigurationResponse> payoutConfiguration = adyenService.getPayoutConfiguration(user, balanceAccountId);
            return ResponseEntity.ok(payoutConfiguration);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }

    }

    @PostMapping("/payoutConfiguration")
    public ResponseEntity<?> createPayoutConfiguration(@RequestBody PayoutConfigurationRequest payoutConfigurationRequest) {
        try {
            User user = userRepository.findById(payoutConfigurationRequest.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            PayoutConfigurationResponse payoutConfigurationResponse = adyenService.createPayoutConfiguration(
                    payoutConfigurationRequest.getBalanceAccountId(),
                    payoutConfigurationRequest.getCurrencyCode(),
                    payoutConfigurationRequest.getRegular(),
                    payoutConfigurationRequest.getInstant(),
                    payoutConfigurationRequest.getTransferInstrumentId(),
                    payoutConfigurationRequest.getSchedule());

            return ResponseEntity.ok(payoutConfigurationResponse);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/payoutAccount/{userId}")
    public ResponseEntity<?> getPayoutAccount(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            List<PayoutAccount> payoutAccounts = adyenService.getPayoutAccount(user.getLegalEntityId());

            return ResponseEntity.ok(payoutAccounts);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/bankAccount/")
    public ResponseEntity<?> createBankAccount(@RequestBody BusinessBankAccountRequest businessBankAccountRequest) {
        try {
            User user = userRepository.findById(businessBankAccountRequest.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            String balanceAccountId = adyenService.createBalanceAccountId(user.getAccountHolderId(), user.getCurrencyCode());
            //adyenService.createBusinessBankAccount(balanceAccountId, user.getCountryCode(), );
            return ResponseEntity.ok(null);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/validateKyc/{userId}")
    public ResponseEntity<?> validateKyc(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getLegalEntityId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no legalEntityId");
            }

            kycService.validateKyc(user.getLegalEntityId(), user.getUserType(), user.getCountryCode());
            kycService.signDocument(user.getLegalEntityId(), user.getUserType(), user.getActivityReason(), user.getCapital(), user.getBank(), user.getIssuing());


            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            response.put("message", "KYC processed successfully");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }



}
