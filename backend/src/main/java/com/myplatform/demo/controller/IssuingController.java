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
                    request.getBrand(),
                    request.getEmail(),
                    request.getPhone()
            );

            Card card = new Card();
            card.setPaymentInstrumentId(paymentInstrumentId);
            card.setUser(user);
            cardRepository.save(card);

            if (request.getTransactionRules() != null && !request.getTransactionRules().isEmpty()) {
                for (TransactionRuleRequest ruleRequest : request.getTransactionRules()) {
                    if ("blockedMccs".equals(ruleRequest.getType())) {
                        if (ruleRequest.getBlockedMccs() != null && !ruleRequest.getBlockedMccs().isEmpty()) {
                            issuingService.createMccBlockRule(
                                    paymentInstrumentId,
                                    ruleRequest.getBlockedMccs()
                            );
                        }
                    } else {
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
            }

            CardResponse response = issuingService.getCardDetails(paymentInstrumentId);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error creating card: " + e.getMessage());
        }
    }

    @GetMapping("/cards/{userId}")
    public ResponseEntity<?> getCards(@PathVariable Long userId, @RequestParam(required = false) String status) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            List<Card> cards = cardRepository.findByUser(user);
            List<CardResponse> responses = new ArrayList<>();

            for (Card card : cards) {
                try {
                    CardResponse cardResponse = issuingService.getCardDetails(card.getPaymentInstrumentId());
                    if (status == null || status.equalsIgnoreCase(cardResponse.getStatus())) {
                        responses.add(cardResponse);
                    }
                } catch (Exception e) {
                    if (status == null || "error".equalsIgnoreCase(status)) {
                        CardResponse errorCard = new CardResponse();
                        errorCard.setPaymentInstrumentId(card.getPaymentInstrumentId());
                        errorCard.setStatus("error");
                        responses.add(errorCard);
                    }
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

            String ruleId;
            if ("blockedMccs".equals(request.getType())) {
                if (request.getBlockedMccs() == null || request.getBlockedMccs().isEmpty()) {
                    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("blockedMccs list is required for this rule type");
                }
                ruleId = issuingService.createMccBlockRule(
                        request.getPaymentInstrumentId(),
                        request.getBlockedMccs()
                );
            } else {
                String currencyCode = request.getCurrencyCode() != null 
                        ? request.getCurrencyCode() 
                        : card.getUser().getCurrencyCode();

                ruleId = issuingService.createTransactionRule(
                        request.getPaymentInstrumentId(),
                        request.getType(),
                        request.getValue(),
                        currencyCode
                );
            }

            Map<String, String> response = new HashMap<>();
            response.put("ruleId", ruleId);
            response.put("status", "success");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error adding transaction rule: " + e.getMessage());
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

    @GetMapping("/phone-prefixes")
    public ResponseEntity<List<PhonePrefix>> getPhonePrefixes() {
        List<PhonePrefix> prefixes = List.of(
                new PhonePrefix("+1", "United States", "🇺🇸"),
                new PhonePrefix("+1", "Canada", "🇨🇦"),
                new PhonePrefix("+44", "United Kingdom", "🇬🇧"),
                new PhonePrefix("+33", "France", "🇫🇷"),
                new PhonePrefix("+49", "Germany", "🇩🇪"),
                new PhonePrefix("+31", "Netherlands", "🇳🇱"),
                new PhonePrefix("+34", "Spain", "🇪🇸"),
                new PhonePrefix("+39", "Italy", "🇮🇹"),
                new PhonePrefix("+32", "Belgium", "🇧🇪"),
                new PhonePrefix("+41", "Switzerland", "🇨🇭"),
                new PhonePrefix("+43", "Austria", "🇦🇹"),
                new PhonePrefix("+46", "Sweden", "🇸🇪"),
                new PhonePrefix("+47", "Norway", "🇳🇴"),
                new PhonePrefix("+45", "Denmark", "🇩🇰"),
                new PhonePrefix("+358", "Finland", "🇫🇮"),
                new PhonePrefix("+353", "Ireland", "🇮🇪"),
                new PhonePrefix("+351", "Portugal", "🇵🇹"),
                new PhonePrefix("+48", "Poland", "🇵🇱"),
                new PhonePrefix("+420", "Czech Republic", "🇨🇿"),
                new PhonePrefix("+36", "Hungary", "🇭🇺"),
                new PhonePrefix("+40", "Romania", "🇷🇴"),
                new PhonePrefix("+30", "Greece", "🇬🇷"),
                new PhonePrefix("+61", "Australia", "🇦🇺"),
                new PhonePrefix("+81", "Japan", "🇯🇵"),
                new PhonePrefix("+65", "Singapore", "🇸🇬"),
                new PhonePrefix("+852", "Hong Kong", "🇭🇰"),
                new PhonePrefix("+971", "United Arab Emirates", "🇦🇪"),
                new PhonePrefix("+966", "Saudi Arabia", "🇸🇦"),
                new PhonePrefix("+55", "Brazil", "🇧🇷"),
                new PhonePrefix("+52", "Mexico", "🇲🇽")
        );
        return ResponseEntity.ok(prefixes);
    }
}
