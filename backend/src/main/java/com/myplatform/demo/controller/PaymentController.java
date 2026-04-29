package com.myplatform.demo.controller;

import com.adyen.model.checkout.PaymentCompletionDetails;
import com.adyen.model.checkout.PaymentDetailsRequest;
import com.adyen.model.checkout.PaymentDetailsResponse;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.PaymentSessionResponse;
import com.myplatform.demo.model.RequestPayment;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.GpayJwtService;
import com.myplatform.demo.service.PaymentCheckoutService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    private final UserRepository userRepository;
    private final PaymentCheckoutService paymentCheckoutService;
    private final GpayJwtService gpayJwtService;

    public PaymentController(UserRepository userRepository,
                             PaymentCheckoutService paymentCheckoutService,
                             GpayJwtService gpayJwtService) {
        this.userRepository = userRepository;
        this.paymentCheckoutService = paymentCheckoutService;
        this.gpayJwtService = gpayJwtService;
    }

    @PostMapping("/session")
    public ResponseEntity<PaymentSessionResponse> sendPayment(@RequestBody RequestPayment requestPayment) throws Exception {
        User user = userRepository.findById(requestPayment.getUserId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }

        PaymentSessionResponse paymentSessionResponse = paymentCheckoutService.createPaymentSession(
                requestPayment.getCurrencyCode(),
                requestPayment.getAmount(),
                requestPayment.getReference(),
                user.getId(),
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

            PaymentDetailsResponse paymentDetailsResponse = paymentCheckoutService.getPaymentsApi().paymentsDetails(detailsRequest);

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
        } catch (Exception e) {
            return new RedirectView("/result/error?reason=" + e.getMessage());
        }
    }

    @GetMapping("/client-key")
    public ResponseEntity<Map<String, String>> getClientKey() {
        return ResponseEntity.ok(Map.of("key", paymentCheckoutService.getClientKey()));
    }

    @GetMapping("/gpay-jwt")
    public ResponseEntity<Map<String, String>> getGooglePayJwt(@RequestParam String hostname) throws Exception {
        String authJwt = gpayJwtService.generateAuthJwt(hostname);
        Map<String, String> response = new HashMap<>();
        response.put("googlePayJwtToken", authJwt);
        return ResponseEntity.ok(response);
    }
}
