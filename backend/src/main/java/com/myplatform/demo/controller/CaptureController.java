package com.myplatform.demo.controller;

import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.CancelPaymentRequest;
import com.myplatform.demo.dto.CaptureRequest;
import com.myplatform.demo.dto.CheckoutPaymentDTO;
import com.myplatform.demo.dto.SessionResultRequest;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.CheckoutPaymentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Captures page: checkout payments with delayed or manual capture. */
@RestController
@RequestMapping("/api/captures")
public class CaptureController {

    private final UserRepository userRepository;
    private final CheckoutPaymentService checkoutPaymentService;

    public CaptureController(UserRepository userRepository, CheckoutPaymentService checkoutPaymentService) {
        this.userRepository = userRepository;
        this.checkoutPaymentService = checkoutPaymentService;
    }

    @GetMapping
    public ResponseEntity<List<CheckoutPaymentDTO>> list(@RequestParam String userId) {
        requireUser(userId);
        return ResponseEntity.ok(checkoutPaymentService.list(userId));
    }

    /** Called by the Drop-in after the payment, so the payment gets its pspReference without waiting for the webhook. */
    @PostMapping("/{paymentId}/session-result")
    public ResponseEntity<CheckoutPaymentDTO> syncSessionResult(@PathVariable String paymentId,
                                                                @RequestBody SessionResultRequest request) throws Exception {
        requireUser(request.getUserId());
        ApiLogContext.setUserId(request.getUserId());
        return ResponseEntity.ok(checkoutPaymentService.syncSessionResult(paymentId, request.getUserId(), request.getSessionResult()));
    }

    @PostMapping("/{paymentId}/capture")
    public ResponseEntity<CheckoutPaymentDTO> capture(@PathVariable String paymentId,
                                                      @RequestBody CaptureRequest request) throws Exception {
        requireUser(request.getUserId());
        ApiLogContext.setUserId(request.getUserId());
        return ResponseEntity.ok(checkoutPaymentService.capture(paymentId, request));
    }

    @PostMapping("/{paymentId}/cancel")
    public ResponseEntity<CheckoutPaymentDTO> cancel(@PathVariable String paymentId,
                                                     @RequestBody CancelPaymentRequest request) throws Exception {
        requireUser(request.getUserId());
        ApiLogContext.setUserId(request.getUserId());
        return ResponseEntity.ok(checkoutPaymentService.cancel(paymentId, request.getUserId()));
    }

    private void requireUser(String userId) {
        if (userId == null || userId.isBlank()) {
            throw new BadRequestException("userId is required");
        }
        userRepository.findById(userId).orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
