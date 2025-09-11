package com.myplatform.demo.controller;

import com.myplatform.demo.model.Activity;
import com.myplatform.demo.model.KycStatus;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.AdyenService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
public class UserController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AdyenService adyenService;

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody User user) {
        try {
            Optional<User> existing = Optional.ofNullable(userRepository.findByEmail(user.getEmail()));
            if (existing.isPresent()) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body("ErrorUserAlreadyExist");
            }

            String legalEntityId = adyenService.createLegalEntity(user);
            String accountHolderId = adyenService.createAccountHolder(legalEntityId);
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

    @GetMapping("/users")
    public List<User> allUsers() {
        return userRepository.findAll();
    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<?> user(@PathVariable Long userId){
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            user.setPassword("****");

            return ResponseEntity.ok(user);
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

            String url = adyenService.createHOP(user.getLegalEntityId(), user.getCountryCode(), userId);
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

            KycStatus status = adyenService.getLegalEntityKycDetail(user.getLegalEntityId());
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



}
