package com.myplatform.demo.controller;

import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.StandingOrderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/standing-orders")
public class StandingOrderController {

    private static final Logger log = LoggerFactory.getLogger(StandingOrderController.class);

    private final UserRepository userRepository;
    private final StandingOrderService service;
    private final BalanceAccountService balanceAccountService;

    public StandingOrderController(UserRepository userRepository,
                                   StandingOrderService service,
                                   BalanceAccountService balanceAccountService) {
        this.userRepository = userRepository;
        this.service = service;
        this.balanceAccountService = balanceAccountService;
    }

    @GetMapping("/{userId}")
    public ResponseEntity<Map<String, Object>> list(@PathVariable Long userId) throws Exception {
        User user = findUser(userId);
        return ResponseEntity.ok(service.listStandingOrders(getBankingBalanceAccountId(user)));
    }

    @GetMapping("/{userId}/{standingOrderId}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable Long userId,
                                                   @PathVariable String standingOrderId) throws Exception {
        User user = findUser(userId);
        return ResponseEntity.ok(service.getStandingOrder(getBankingBalanceAccountId(user), standingOrderId));
    }

    @PatchMapping("/{userId}/{standingOrderId}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long userId,
                                                      @PathVariable String standingOrderId,
                                                      @RequestBody Map<String, Object> body) throws Exception {
        User user = findUser(userId);
        return ResponseEntity.ok(service.updateStandingOrder(getBankingBalanceAccountId(user), standingOrderId, body));
    }

    @DeleteMapping("/{userId}/{standingOrderId}")
    public ResponseEntity<Void> delete(@PathVariable Long userId,
                                       @PathVariable String standingOrderId) throws Exception {
        User user = findUser(userId);
        service.deleteStandingOrder(getBankingBalanceAccountId(user), standingOrderId);
        return ResponseEntity.noContent().build();
    }

    // ---- SCA flow ----

    @PostMapping("/{userId}/initiate")
    public ResponseEntity<Map<String, Object>> initiate(@PathVariable Long userId,
                                                        @RequestBody Map<String, Object> payload) throws Exception {
        User user = findUser(userId);
        @SuppressWarnings("unchecked")
        Map<String, Object> standingOrder = (Map<String, Object>) payload.get("standingOrder");
        String sdkOutput = (String) payload.get("sdkOutput");

        Map<String, Object> result = service.initiateStandingOrder(getBankingBalanceAccountId(user), standingOrder, sdkOutput);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/{userId}/finalize")
    public ResponseEntity<Map<String, Object>> finalizeOrder(@PathVariable Long userId,
                                                             @RequestBody Map<String, Object> payload) throws Exception {
        User user = findUser(userId);
        @SuppressWarnings("unchecked")
        Map<String, Object> standingOrder = (Map<String, Object>) payload.get("standingOrder");
        String sdkOutput = (String) payload.get("sdkOutput");

        Map<String, Object> result = service.finalizeStandingOrder(getBankingBalanceAccountId(user), standingOrder, sdkOutput);
        return ResponseEntity.ok(result);
    }

    private String getBankingBalanceAccountId(User user) throws Exception {
        String bankAccountId = user.getBankAccountId();
        if (bankAccountId == null || bankAccountId.isBlank()) {
            throw new BadRequestException("User has no bank account");
        }
        String resolvedBA = balanceAccountService.getBalanceAccountIdForPaymentInstrument(bankAccountId);
        log.info("[StandingOrder] User {} -> bankAccountId (PI): {}, balanceAccountId (main): {}, resolved banking BA: {}",
                user.getId(), bankAccountId, user.getBalanceAccountId(), resolvedBA);
        return resolvedBA;
    }

    private User findUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
