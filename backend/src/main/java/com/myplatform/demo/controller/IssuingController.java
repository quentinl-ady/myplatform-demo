package com.myplatform.demo.controller;

import com.myplatform.demo.dto.*;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.CardTransferService;
import com.myplatform.demo.service.IssuingService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/issuing")
public class IssuingController {

    private final IssuingService issuingService;
    private final CardTransferService cardTransferService;
    private final UserRepository userRepository;
    private final CardRepository cardRepository;

    public IssuingController(IssuingService issuingService,
                             CardTransferService cardTransferService,
                             UserRepository userRepository,
                             CardRepository cardRepository) {
        this.issuingService = issuingService;
        this.cardTransferService = cardTransferService;
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
    }

    @PostMapping("/cards")
    public ResponseEntity<CardResponse> createCard(@RequestBody CreateCardRequest request) throws Exception {
        User user = userRepository.findById(request.getUserId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        if (user.getBalanceAccountId() == null) {
            throw new BadRequestException("User has no balance account");
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
                        issuingService.createMccBlockRule(paymentInstrumentId, ruleRequest.getBlockedMccs());
                    }
                } else {
                    String currencyCode = ruleRequest.getCurrencyCode() != null
                            ? ruleRequest.getCurrencyCode()
                            : user.getCurrencyCode();
                    issuingService.createTransactionRule(paymentInstrumentId, ruleRequest.getType(), ruleRequest.getValue(), currencyCode);
                }
            }
        }

        return ResponseEntity.ok(issuingService.getCardDetails(paymentInstrumentId));
    }

    @GetMapping("/cards/{userId}")
    public ResponseEntity<List<CardResponse>> getCards(@PathVariable Long userId, @RequestParam(required = false) String status) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));

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
    }

    @GetMapping("/card/{paymentInstrumentId}")
    public ResponseEntity<CardResponse> getCardDetails(@PathVariable String paymentInstrumentId) throws Exception {
        return ResponseEntity.ok(issuingService.getCardDetails(paymentInstrumentId));
    }

    @PutMapping("/cards/status")
    public ResponseEntity<Map<String, String>> updateCardStatus(@RequestBody UpdateCardStatusRequest request) throws Exception {
        issuingService.updateCardStatus(request.getPaymentInstrumentId(), request.getStatus());
        return ResponseEntity.ok(Map.of("status", "success", "newStatus", request.getStatus()));
    }

    @PostMapping("/rules")
    public ResponseEntity<Map<String, String>> addTransactionRule(@RequestBody AddTransactionRuleRequest request) throws Exception {
        Card card = cardRepository.findByPaymentInstrumentId(request.getPaymentInstrumentId());
        if (card == null) {
            throw new ResourceNotFoundException("Card not found");
        }

        String ruleId;
        if ("blockedMccs".equals(request.getType())) {
            if (request.getBlockedMccs() == null || request.getBlockedMccs().isEmpty()) {
                throw new BadRequestException("blockedMccs list is required for this rule type");
            }
            ruleId = issuingService.createMccBlockRule(request.getPaymentInstrumentId(), request.getBlockedMccs());
        } else {
            String currencyCode = request.getCurrencyCode() != null
                    ? request.getCurrencyCode()
                    : card.getUser().getCurrencyCode();
            ruleId = issuingService.createTransactionRule(request.getPaymentInstrumentId(), request.getType(), request.getValue(), currencyCode);
        }

        return ResponseEntity.ok(Map.of("ruleId", ruleId, "status", "success"));
    }

    @GetMapping("/rules/{paymentInstrumentId}")
    public ResponseEntity<List<TransactionRuleResponseDTO>> getTransactionRules(@PathVariable String paymentInstrumentId) throws Exception {
        return ResponseEntity.ok(issuingService.getTransactionRulesForCard(paymentInstrumentId));
    }

    @PutMapping("/rules/{ruleId}")
    public ResponseEntity<Map<String, String>> updateTransactionRule(@PathVariable String ruleId, @RequestBody Map<String, String> request) throws Exception {
        issuingService.updateTransactionRule(ruleId, request.get("status"));
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @DeleteMapping("/rules/{ruleId}")
    public ResponseEntity<Map<String, String>> deleteTransactionRule(@PathVariable String ruleId) throws Exception {
        issuingService.deleteTransactionRule(ruleId);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    @GetMapping("/publicKey")
    public ResponseEntity<Map<String, String>> getPublicKey(@RequestParam String purpose) throws Exception {
        return ResponseEntity.ok(Map.of("publicKey", issuingService.getPublicKey(purpose)));
    }

    @PostMapping("/reveal")
    public ResponseEntity<Map<String, String>> revealCardData(@RequestBody Map<String, String> request) throws Exception {
        String decryptedData = issuingService.revealCardData(request.get("paymentInstrumentId"));
        return ResponseEntity.ok(Map.of("cardData", decryptedData));
    }

    @GetMapping("/transfers")
    public ResponseEntity<List<CardTransferDTO>> getCardTransfers(
            @RequestParam Long userId,
            @RequestParam(required = false) String paymentInstrumentId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        return ResponseEntity.ok(cardTransferService.getCardTransfers(user.getAccountHolderId(), paymentInstrumentId));
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
