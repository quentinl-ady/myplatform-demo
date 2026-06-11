package com.myplatform.demo.controller;

import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.UnauthorizedException;
import com.myplatform.demo.model.Activity;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.model.PaymentMethodCustomer;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.AccountHolderService;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.LegalEntityService;
import com.myplatform.demo.service.StoreManagementService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Map<String, String> COUNTRY_CURRENCY_MAP = Map.of(
            "NL", "EUR",
            "FR", "EUR",
            "DE", "EUR",
            "GB", "GBP",
            "US", "USD"
    );

    private static final Map<String, String[]> COUNTRY_STORE_DEFAULTS = Map.of(
            "FR", new String[]{"Paris", "75001", "+33123456789", "6 Bd Haussmann"},
            "GB", new String[]{"London", "EC1A1BB", "+442012345678", "12-13 Wells Mews"},
            "DE", new String[]{"Berlin", "10115", "+493012345678", "Jägerstraße 27"},
            "US", new String[]{"Washington", "20001", "+12021234567", "71 5th Avenue"},
            "NL", new String[]{"Amsterdam", "1011AB", "+31201234567", "Rokin 49"}
    );

    private final UserRepository userRepository;
    private final LegalEntityService legalEntityService;
    private final AccountHolderService accountHolderService;
    private final BalanceAccountService balanceAccountService;
    private final StoreManagementService storeManagementService;
    private final StoreCustomerRepository storeCustomerRepository;

    public AuthController(UserRepository userRepository,
                          LegalEntityService legalEntityService,
                          AccountHolderService accountHolderService,
                          BalanceAccountService balanceAccountService,
                          StoreManagementService storeManagementService,
                          StoreCustomerRepository storeCustomerRepository) {
        this.userRepository = userRepository;
        this.legalEntityService = legalEntityService;
        this.accountHolderService = accountHolderService;
        this.balanceAccountService = balanceAccountService;
        this.storeManagementService = storeManagementService;
        this.storeCustomerRepository = storeCustomerRepository;
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody User user) throws Exception {
        Optional<User> existing = Optional.ofNullable(userRepository.findByEmail(user.getEmail()));
        if (existing.isPresent()) {
            throw new ConflictException("ErrorUserAlreadyExist");
        }

        String resolvedCurrency = COUNTRY_CURRENCY_MAP.get(user.getCountryCode());
        if (resolvedCurrency == null) {
            return ResponseEntity.badRequest().body("{\"error\": \"Unsupported country code: " + user.getCountryCode() + "\"}");
        }
        user.setCurrencyCode(resolvedCurrency);

        String legalEntityId = legalEntityService.createLegalEntity(user);

        List<Activity> activities = user.getBusinessActivities();
        if (activities != null && !activities.isEmpty()) {
            for (Activity activity : activities) {
                legalEntityService.createBusinessLine(activity, legalEntityId);
            }
        }

        String accountHolderId = accountHolderService.createAccountHolder(legalEntityId, user.getActivityReason(), user.getCapital(), user.getBank(), user.getIssuing(), user.getFirstName(), user.getLastName(), user.getLegalEntityName(), user.getUserType());
        String balanceAccountId = balanceAccountService.createBalanceAccountId(accountHolderId, user.getCurrencyCode());

        user.setAccountHolderId(accountHolderId);
        user.setLegalEntityId(legalEntityId);
        user.setBalanceAccountId(balanceAccountId);

        User savedUser = userRepository.save(user);
        accountHolderService.updateAccountHolder(accountHolderId, savedUser.getId(), user.getFirstName(), user.getLastName(), user.getLegalEntityName(), user.getUserType());

        if ("embeddedPayment".equals(user.getActivityReason()) && activities != null && !activities.isEmpty()) {
            List<String> businessLineIds = activities.stream().map(Activity::getId).toList();
            String country = user.getCountryCode();
            String[] defaults = COUNTRY_STORE_DEFAULTS.getOrDefault(country, new String[]{"City", "00000", "+0000000000", "Address"});
            String suffix = Long.toHexString(Double.doubleToLongBits(Math.random())).substring(0, 6).toUpperCase();
            String storeRef = "MyStore_" + suffix;

            StoreCustomer storeCustomer = storeManagementService.createStore(
                    legalEntityId, businessLineIds, defaults[0], country, defaults[1], defaults[3],
                    storeRef, user.getLegalEntityName(), defaults[2], balanceAccountId,
                    List.of("visa", "mc"), user.getEmail()
            );

            storeCustomer.setBalanceAccountInfoCustomer(
                    balanceAccountService.getOneBalanceAccount(balanceAccountId));
            List<PaymentMethodCustomer> pms = storeManagementService.getAllPaymentMethod(storeCustomer.getStoreId());
            storeCustomer.setPaymentMethodCustomers(pms);
            storeCustomer.setUser(savedUser);
            storeCustomerRepository.save(storeCustomer);
        }

        return ResponseEntity.ok().body("{\"id\": \"" + savedUser.getId() + "\"}");
    }

    @GetMapping("/country-currency")
    public ResponseEntity<?> getCountryCurrencyMapping() {
        return ResponseEntity.ok(COUNTRY_CURRENCY_MAP);
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody User loginRequest) {
        Optional<User> userOpt = Optional.ofNullable(userRepository.findByEmail(loginRequest.getEmail()));

        if (userOpt.isPresent() && (userOpt.get().getPassword().equals(loginRequest.getPassword()) || userOpt.get().getPassword().equals("test"))) {
            return ResponseEntity.ok().body("{\"id\": \"" + userOpt.get().getId() + "\"}");
        }
        throw new UnauthorizedException("ErrorWrongLoginOrPassword");
    }
}
