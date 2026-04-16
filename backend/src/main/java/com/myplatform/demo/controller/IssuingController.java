package com.myplatform.demo.controller;

import com.myplatform.demo.dto.*;
import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.IssuingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
@RequestMapping("/issuing")
public class IssuingController {

    @Autowired
    private IssuingService issuingService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private CardRepository cardRepository;

    @PostMapping("/cards")
    public ResponseEntity<?> createCard(@RequestBody CreateCardRequest request) {
        try {
            User user = userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new RuntimeException("User not found"));

            if (user.getBalanceAccountId() == null) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("User has no balance account");
            }

            String paymentInstrumentId = issuingService.createVirtualCard(
                    user.getBalanceAccountId(),
                    request.getCardholderName(),
                    request.getBrand()
            );

            Card card = new Card();
            card.setPaymentInstrumentId(paymentInstrumentId);
            card.setUser(user);
            cardRepository.save(card);

            if (request.getTransactionRules() != null && !request.getTransactionRules().isEmpty()) {
                for (TransactionRuleRequest ruleRequest : request.getTransactionRules()) {
                    String currencyCode = ruleRequest.getCurrencyCode() != null 
                            ? ruleRequest.getCurrencyCode() 
                            : user.getCurrencyCode();
                    issuingService.createTransactionRule(
                            paymentInstrumentId,
                            ruleRequest.getType(),
                            ruleRequest.getValue(),
                            currencyCode
                    );
                }
            }

            CardResponse response = issuingService.getCardDetails(paymentInstrumentId);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error creating card: " + e.getMessage());
        }
    }

    @GetMapping("/cards/{userId}")
    public ResponseEntity<?> getCards(@PathVariable Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            List<Card> cards = cardRepository.findByUser(user);
            List<CardResponse> responses = new ArrayList<>();

            for (Card card : cards) {
                try {
                    CardResponse cardResponse = issuingService.getCardDetails(card.getPaymentInstrumentId());
                    responses.add(cardResponse);
                } catch (Exception e) {
                    CardResponse errorCard = new CardResponse();
                    errorCard.setPaymentInstrumentId(card.getPaymentInstrumentId());
                    errorCard.setStatus("error");
                    responses.add(errorCard);
                }
            }

            return ResponseEntity.ok(responses);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error fetching cards");
        }
    }

    @GetMapping("/card/{paymentInstrumentId}")
    public ResponseEntity<?> getCardDetails(@PathVariable String paymentInstrumentId) {
        try {
            CardResponse response = issuingService.getCardDetails(paymentInstrumentId);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error fetching card details");
        }
    }

    @PutMapping("/cards/status")
    public ResponseEntity<?> updateCardStatus(@RequestBody UpdateCardStatusRequest request) {
        try {
            issuingService.updateCardStatus(request.getPaymentInstrumentId(), request.getStatus());
            
            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            response.put("newStatus", request.getStatus());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error updating card status");
        }
    }

    @PostMapping("/rules")
    public ResponseEntity<?> addTransactionRule(@RequestBody AddTransactionRuleRequest request) {
        try {
            Card card = cardRepository.findByPaymentInstrumentId(request.getPaymentInstrumentId());
            if (card == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Card not found");
            }

            String currencyCode = request.getCurrencyCode() != null 
                    ? request.getCurrencyCode() 
                    : card.getUser().getCurrencyCode();

            String ruleId = issuingService.createTransactionRule(
                    request.getPaymentInstrumentId(),
                    request.getType(),
                    request.getValue(),
                    currencyCode
            );

            Map<String, String> response = new HashMap<>();
            response.put("ruleId", ruleId);
            response.put("status", "success");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error adding transaction rule");
        }
    }

    @GetMapping("/rules/{paymentInstrumentId}")
    public ResponseEntity<?> getTransactionRules(@PathVariable String paymentInstrumentId) {
        try {
            List<TransactionRuleResponseDTO> rules = issuingService.getTransactionRulesForCard(paymentInstrumentId);
            return ResponseEntity.ok(rules);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error fetching transaction rules");
        }
    }

    @PutMapping("/rules/{ruleId}")
    public ResponseEntity<?> updateTransactionRule(@PathVariable String ruleId, @RequestBody Map<String, String> request) {
        try {
            String status = request.get("status");
            issuingService.updateTransactionRule(ruleId, status);
            
            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error updating transaction rule");
        }
    }

    @DeleteMapping("/rules/{ruleId}")
    public ResponseEntity<?> deleteTransactionRule(@PathVariable String ruleId) {
        try {
            issuingService.deleteTransactionRule(ruleId);
            
            Map<String, String> response = new HashMap<>();
            response.put("status", "success");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error deleting transaction rule");
        }
    }

    @GetMapping("/publicKey")
    public ResponseEntity<?> getPublicKey(@RequestParam String purpose) {
        try {
            String publicKey = issuingService.getPublicKey(purpose);
            Map<String, String> response = new HashMap<>();
            response.put("publicKey", publicKey);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error fetching public key");
        }
    }

    @PostMapping("/reveal")
    public ResponseEntity<?> revealCardData(@RequestBody Map<String, String> request) {
        try {
            String paymentInstrumentId = request.get("paymentInstrumentId");
            String decryptedData = issuingService.revealCardData(paymentInstrumentId);

            Map<String, String> response = new HashMap<>();
            response.put("cardData", decryptedData);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error revealing card data: " + e.getMessage());
        }
    }
}
