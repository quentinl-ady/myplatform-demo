package com.myplatform.demo.controller;

import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.TopUpModels.*;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.TopUpService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/top-ups/{userId}")
public class TopUpController {
    private final UserRepository users;
    private final TopUpService topUps;

    public TopUpController(UserRepository users, TopUpService topUps) {
        this.users = users;
        this.topUps = topUps;
    }

    @GetMapping
    public Context context(@PathVariable String userId) {
        return topUps.context(user(userId));
    }

    @GetMapping("/bank-accounts")
    public List<BankAccount> bankAccounts(@PathVariable String userId) throws Exception {
        return topUps.bankAccounts(user(userId));
    }

    @PostMapping("/capability")
    public Map<String, Capability> requestCapability(@PathVariable String userId) throws Exception {
        return topUps.requestCapability(user(userId));
    }

    @PostMapping
    public Result topUp(@PathVariable String userId, @RequestBody Payment request) throws Exception {
        return topUps.topUp(user(userId), request);
    }

    @PostMapping("/sweeps")
    public Sweep createSweep(@PathVariable String userId, @RequestBody SweepRequest request) throws Exception {
        return topUps.createSweep(user(userId), request);
    }

    @PatchMapping("/sweeps/{sweepId}")
    public Sweep updateSweep(@PathVariable String userId, @PathVariable String sweepId,
                             @RequestBody SweepStatus request) throws Exception {
        return topUps.updateSweep(user(userId), sweepId, request.active());
    }

    @DeleteMapping("/sweeps/{sweepId}")
    public ResponseEntity<Void> deleteSweep(@PathVariable String userId, @PathVariable String sweepId) throws Exception {
        topUps.deleteSweep(user(userId), sweepId);
        return ResponseEntity.noContent().build();
    }

    private User user(String userId) {
        ApiLogContext.setUserId(userId);
        return users.findById(userId).orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }
}
