package com.myplatform.demo.controller;

import com.adyen.model.checkout.PaymentCompletionDetails;
import com.adyen.model.checkout.PaymentDetailsRequest;
import com.adyen.model.checkout.PaymentDetailsResponse;
import com.myplatform.demo.dto.StoredPaymentMethodDTO;
import com.myplatform.demo.dto.TokenPaymentRequest;
import com.myplatform.demo.dto.TokenPaymentResponse;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.PaymentSessionResponse;
import com.myplatform.demo.model.RequestPayment;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.service.IssuingPaymentCheckoutService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/issuing-payments")
public class IssuingPaymentController {

    private final UserRepository userRepository;
    private final IssuingPaymentCheckoutService issuingPaymentCheckoutService;

    public IssuingPaymentController(UserRepository userRepository,
                                    IssuingPaymentCheckoutService issuingPaymentCheckoutService) {
        this.userRepository = userRepository;
        this.issuingPaymentCheckoutService = issuingPaymentCheckoutService;
    }

    @PostMapping("/session")
    public ResponseEntity<PaymentSessionResponse> sendPayment(@RequestBody RequestPayment requestPayment) throws Exception {
        String issuingUserId = issuingPaymentCheckoutService.getIssuingUserId();
        User user = userRepository.findById(issuingUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Issuing user not found"));
        ApiLogContext.setUserId(issuingUserId);

        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("Issuing user has no legalEntityId");
        }

        PaymentSessionResponse paymentSessionResponse = issuingPaymentCheckoutService.createPaymentSession(
                requestPayment.getCurrencyCode(),
                requestPayment.getAmount(),
                requestPayment.getReference(),
                requestPayment.getStoreReference(),
                user.getActivityReason(),
                user.getBalanceAccountId());

        return ResponseEntity.ok(paymentSessionResponse);
    }

    @GetMapping("/redirect")
    public RedirectView handleShopperRedirect(@RequestParam(required = false) String payload,
                                              @RequestParam(required = false) String redirectResult) {
        try {
            PaymentCompletionDetails completionDetails = new PaymentCompletionDetails();
            if (redirectResult != null && !redirectResult.isEmpty()) {
                completionDetails.redirectResult(redirectResult);
            } else if (payload != null && !payload.isEmpty()) {
                completionDetails.payload(payload);
            }

            PaymentDetailsRequest detailsRequest = new PaymentDetailsRequest();
            detailsRequest.setDetails(completionDetails);

            String redirectURL = "/result/";
            return new RedirectView(redirectURL + "success");
        } catch (Exception e) {
            return new RedirectView("/result/error?reason=" + e.getMessage());
        }
    }

    @GetMapping("/client-key")
    public ResponseEntity<Map<String, String>> getClientKey() {
        return ResponseEntity.ok(Map.of("key", issuingPaymentCheckoutService.getClientKey()));
    }

    @GetMapping("/user-info")
    public ResponseEntity<Map<String, String>> getIssuingUserInfo() {
        String issuingUserId = issuingPaymentCheckoutService.getIssuingUserId();
        User user = userRepository.findById(issuingUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Issuing user not found"));

        return ResponseEntity.ok(Map.of(
                "userId", issuingUserId,
                "activityReason", user.getActivityReason() != null ? user.getActivityReason() : "",
                "countryCode", user.getCountryCode() != null ? user.getCountryCode() : "FR"
        ));
    }

    @PostMapping("/tokenize-session")
    public ResponseEntity<PaymentSessionResponse> createTokenizationSession(@RequestBody RequestPayment requestPayment) throws Exception {
        String issuingUserId = issuingPaymentCheckoutService.getIssuingUserId();
        User user = userRepository.findById(issuingUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Issuing user not found"));
        ApiLogContext.setUserId(issuingUserId);

        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("Issuing user has no legalEntityId");
        }

        PaymentSessionResponse paymentSessionResponse = issuingPaymentCheckoutService.createTokenizationSession(
                requestPayment.getCurrencyCode(),
                requestPayment.getReference(),
                requestPayment.getStoreReference(),
                user.getActivityReason());

        return ResponseEntity.ok(paymentSessionResponse);
    }

    @GetMapping("/stored-payment-methods")
    public ResponseEntity<List<StoredPaymentMethodDTO>> getStoredPaymentMethods(
            @RequestParam(defaultValue = "") String storeReference) throws Exception {

        List<StoredPaymentMethodDTO> storedMethods = issuingPaymentCheckoutService.listStoredPaymentMethods(storeReference);
        return ResponseEntity.ok(storedMethods);
    }

    @DeleteMapping("/stored-payment-methods")
    public ResponseEntity<Map<String, String>> deleteStoredPaymentMethod(
            @RequestParam String storeReference,
            @RequestParam String recurringDetailReference) throws Exception {

        String issuingUserId = issuingPaymentCheckoutService.getIssuingUserId();
        ApiLogContext.setUserId(issuingUserId);

        issuingPaymentCheckoutService.disableStoredPaymentMethod(storeReference, recurringDetailReference);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @PostMapping("/token-payment")
    public ResponseEntity<TokenPaymentResponse> makeTokenPayment(@RequestBody TokenPaymentRequest tokenPaymentRequest) throws Exception {
        String issuingUserId = issuingPaymentCheckoutService.getIssuingUserId();
        User user = userRepository.findById(issuingUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Issuing user not found"));
        ApiLogContext.setUserId(issuingUserId);

        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("Issuing user has no legalEntityId");
        }

        TokenPaymentResponse response = issuingPaymentCheckoutService.makeTokenPayment(
                tokenPaymentRequest.getCurrencyCode(),
                tokenPaymentRequest.getAmount(),
                tokenPaymentRequest.getReference(),
                tokenPaymentRequest.getStoreReference(),
                user.getActivityReason(),
                user.getBalanceAccountId(),
                tokenPaymentRequest.getStoredPaymentMethodId());

        return ResponseEntity.ok(response);
    }
}
