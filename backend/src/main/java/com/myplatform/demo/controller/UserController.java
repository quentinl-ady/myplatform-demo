package com.myplatform.demo.controller;

import com.adyen.model.balanceplatform.Device;
import com.adyen.model.balanceplatform.PaymentInstrument;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.adyen.model.balanceplatform.RegisterSCAResponse;
import com.adyen.model.checkout.PaymentCompletionDetails;
import com.adyen.model.checkout.PaymentDetailsRequest;
import com.adyen.model.checkout.PaymentDetailsResponse;
import com.adyen.service.exception.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.myplatform.demo.dto.*;
import com.myplatform.demo.dto.StoreCustomerDTO;
import com.myplatform.demo.model.*;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.AdyenService;
import com.myplatform.demo.service.GpayJwtService;
import com.myplatform.demo.service.IssuingService;
import com.myplatform.demo.service.KYCService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.servlet.view.RedirectView;

import java.io.IOException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.myplatform.demo.service.AdyenService.SEPA_COUNTRIES;


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

    @Autowired
    private IssuingService issuingService;

    @Autowired
    private GpayJwtService gpayJwtService;

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
            adyenService.updateAccountHolder(accountHolderId, savedUser.getId(), user.getFirstName(), user.getLastName(), user.getLegalEntityName(), user.getUserType());

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


    @GetMapping("/paybylink/{userId}")
    public ResponseEntity<?> getPayByLinksInformation(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getAccountHolderId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no accountHolderId");
            }

            String status = adyenService.createSession(user.getAccountHolderId(), new String[]{
                    "Pay By Link Component: View",
                    "Pay By Link Component: View PII",
                    "Pay By Link Component: Manage Links",
                    "Pay By Link Component: Manage Settings"
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


    @GetMapping("/handleShopperRedirect")
    public RedirectView handleShopperRedirect(@RequestParam(required = false) String payload,
                                              @RequestParam(required = false) String redirectResult) throws IOException, ApiException {

        PaymentCompletionDetails completionDetails = new PaymentCompletionDetails();
        if (redirectResult != null && !redirectResult.isEmpty()) {
            completionDetails.redirectResult(redirectResult);
        } else if (payload != null && !payload.isEmpty()) {
            completionDetails.payload(payload);
        }

        PaymentDetailsRequest detailsRequest = new PaymentDetailsRequest();
        detailsRequest.setDetails(completionDetails);

        PaymentDetailsResponse paymentDetailsResponse = adyenService.getPaymentsApi().paymentsDetails(detailsRequest);

        String redirectURL = "/result/";
        switch (paymentDetailsResponse.getResultCode()) {
            case AUTHORISED:
                redirectURL += "success";
                break;
            case PENDING:
            case RECEIVED:
                redirectURL += "pending";
                break;
            case REFUSED:
                redirectURL += "failed";
                break;
            default:
                redirectURL += "error";
                break;
        }

        return new RedirectView(redirectURL + "?reason=" + paymentDetailsResponse.getResultCode());
    }

//    @PostMapping("/payments/details")
//    public PaymentsResponse handleRedirect(@RequestBody Map<String, String> body) throws ApiException, IOException {
//        String redirectResult = body.get("redirectResult");
//        String payload = body.get("payload"); // selon le paiement
//
//        PaymentsDetailsRequest detailsRequest = new PaymentsDetailsRequest();
//        Map<String, String> details = new HashMap<>();
//        if (redirectResult != null) details.put("redirectResult", redirectResult);
//        if (payload != null) details.put("payload", payload);
//        detailsRequest.setDetails(details);
//
//        return checkout.paymentsDetails(detailsRequest); // SDK officiel
//    }


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

            if (user.getBank()){
                String businessAccountBalanceAccountId = kycService.createBalanceForBusinessAccount(user.getCountryCode(), user.getAccountHolderId());
                kycService.createSweepAcquiringToBanking(user.getCountryCode(), businessAccountBalanceAccountId, user.getBalanceAccountId());
                String paymentInstrumentBankAccount = kycService.createBankAccount(user.getCountryCode(), businessAccountBalanceAccountId);
                PaymentInstrument paymentInstrument = kycService.getPaymentInstrumentDetail(paymentInstrumentBankAccount);

                if("US".equals(user.getCountryCode())){
                    user.setBankAccountNumber(paymentInstrument.getBankAccount().getAccountNumber() + " " + paymentInstrument.getBankAccount().getRoutingNumber());
                } else if("FR".equals(user.getCountryCode()) || "NL".equals(user.getCountryCode())) {
                    user.setBankAccountNumber(paymentInstrument.getBankAccount().getIban());
                } else if ("UK".equals(user.getCountryCode()) || "GB".equals(user.getCountryCode())){
                    user.setBankAccountNumber(paymentInstrument.getBankAccount().getAccountNumber() + " " + paymentInstrument.getBankAccount().getSortCode());
                }
                user.setBankAccountId(paymentInstrumentBankAccount);

                userRepository.save(user);
            }

            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            response.put("message", "KYC processed successfully");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/publicKey")
    public ResponseEntity<?> getPublicKey(@RequestParam String reason) {
        try {
            String publicKey = issuingService.getPublicKey(reason);
            Map<String, String> response = new HashMap<>();
            response.put("publicKey", publicKey);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }



    @GetMapping("/gpay-jwt")
    public ResponseEntity<?> getGooglePayJwt(@RequestParam String hostname) {
        try {
            String authJwt = gpayJwtService.generateAuthJwt(hostname);
            Map<String, String> response = new HashMap<>();
            response.put("googlePayJwtToken", authJwt);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/listDevices/{userId}")
    public ResponseEntity<?> listDevices(@PathVariable Long userId) throws Exception {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            List<Device> devices = adyenService.getListDevices(user.getBankAccountId());
            return ResponseEntity.ok(devices);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/initiateDeviceRegistration")
    public ResponseEntity<?> initiateDeviceRegistration(
            @RequestBody InitiateDeviceRegistrationRequest request) {
        try {
            User user = userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            RegisterSCAResponse response = adyenService.registerDevice(request.getSdkOutput(), user.getBankAccountId());
            return ResponseEntity.ok(response);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/finalizeRegistration")
    public ResponseEntity<?> finalizeRegistration(
            @RequestBody FinalizeRegistrationRequest request) {
        try {
            User user = userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            RegisterSCAFinalResponse response =
                    adyenService.finalizeRegistration(request.getId(), request.getSdkOutput(), user.getBankAccountId());

            return ResponseEntity.ok(response);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @PostMapping("/deleteDevice")
    public ResponseEntity<?> deleteDevice(@RequestBody DeleteDeviceRequest request) {
        try {
            adyenService.deleteDevice(request.getId(), request.getPaymentInstrumentId());
            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            return ResponseEntity.ok(response);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/initiateTransfer")
    public ResponseEntity<?> initiateTransfer(
            @RequestBody TransferRequest request) throws JsonProcessingException {
        try {
            User user = userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            InitiateTransferResponse initiateTransferResponse = adyenService.initiateTransfer(request, user.getBankAccountId());
            return ResponseEntity.ok(initiateTransferResponse);
        }

        catch (HttpClientErrorException e){
            HttpHeaders errorHeaders = e.getResponseHeaders();

            InitiateTransferResponse res = new InitiateTransferResponse();

            if (errorHeaders != null) {
                String wwwAuth = errorHeaders.getFirst("WWW-Authenticate");

                if (wwwAuth != null) {
                    Pattern pattern = Pattern.compile("auth-param1=\"([^\"]+)\"");
                    Matcher matcher = pattern.matcher(wwwAuth);

                    if (matcher.find()) {
                        String authParam1 = matcher.group(1);
                        res.setAuthParam1(authParam1);
                    }
                }
            }



            if(SEPA_COUNTRIES.contains(request.getCounterpartyCountry())){
                res.setIban(request.getIban());
            } else if ("US".equals(request.getCounterpartyCountry())){
                res.setAccountNumber(request.getAccountNumber());
                res.setRoutingNumber(request.getRoutingNumber());
            } else if ("UK".equals(request.getCounterpartyCountry()) || "GB".equals(request.getCounterpartyCountry())){
                res.setAccountNumber(request.getAccountNumber());
                res.setSortCode(request.getSortCode());
            }

            res.setAmount(request.getAmount());
            res.setCounterpartyCountry(request.getCounterpartyCountry());
            return ResponseEntity.ok(res);
        }
        catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }


    @PostMapping("/finalizeTransfer")
    public ResponseEntity<?> finalizeTransfer(@RequestBody TransferRequest request) {
        try {
            User user = userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            adyenService.finalizeTransfer(request, user.getBankAccountId());
            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            return ResponseEntity.ok(response);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/bankAccount/{userId}")
    public ResponseEntity<?> getBankAccountInformation(@PathVariable Long userId) throws Exception {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            BankAccountInformationResponse bankAccountInformationResponse = adyenService.getBankAccountInformation(user.getBankAccountId());
            bankAccountInformationResponse.setBankAccountNumber(user.getBankAccountNumber());
            return ResponseEntity.ok(bankAccountInformationResponse);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/bankAccountFormat/country/{countryCode}")
    public ResponseEntity<?> getBankAccountFormat(@PathVariable String countryCode) throws Exception {
        try {
            String bankAccountFormat = adyenService.getBankAccountFormat(countryCode);
            Map<String, String> response = new HashMap<>();
            response.put("bankAccountFormat", bankAccountFormat);
            return ResponseEntity.ok(response);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/isCrossBorder/")
    public ResponseEntity<?> isCrossBorder(@RequestBody IsCrossBorderRequest request) throws Exception {
        try {
            User user = userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            Boolean isCrossBorder = adyenService.isCrossBorder(request.getCountryCodeCounterparty(), user.getCountryCode());
            Map<String, String> response = new HashMap<>();
            response.put("isCrossBorder", String.valueOf(isCrossBorder));
            return ResponseEntity.ok(response);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @PostMapping("/isBankAccountValid")
    public ResponseEntity<?> isBankAccountValid(@RequestBody IsBankAccountValidRequest request) throws Exception {
        try {
            adyenService.isBankAccountValid(request);
            Map<String, String> response = new HashMap<>();
            response.put("isBankAccountValid", String.valueOf(Boolean.TRUE));
            return ResponseEntity.ok(response);
        } catch (Exception e){
            Map<String, String> response = new HashMap<>();
            response.put("isBankAccountValid", String.valueOf(Boolean.FALSE));
            return ResponseEntity.ok(response);
        }
    }

    @PostMapping("/verifyCounterpartyName")
    public ResponseEntity<?> verifyCounterpartyName(@RequestBody VerifyCounterpartyNameRequest request) throws Exception {
        try {
             CounterpartyVerificationResponse counterpartyVerificationResponse = adyenService.verifyCounterpartyName(request);
            return ResponseEntity.ok(counterpartyVerificationResponse);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }

    @GetMapping("/listTerminal/storeId/{storeId}")
    public ResponseEntity<?> listTerminal(@PathVariable String storeId) throws Exception {
        try {
            List<TerminalResponse> terminalResponseList = adyenService.listTerminal(storeId);
            return ResponseEntity.ok(terminalResponseList);
        } catch (Exception e){
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error");
        }
    }



}
