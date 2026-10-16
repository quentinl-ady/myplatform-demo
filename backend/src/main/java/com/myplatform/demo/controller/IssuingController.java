package com.myplatform.demo.controller;

import com.adyen.service.exception.ApiException;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.*;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.CardRangeCatalog;
import com.myplatform.demo.service.CardTransferService;
import com.myplatform.demo.service.IssuingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/issuing")
public class IssuingController {

    private static final Logger log = LoggerFactory.getLogger(IssuingController.class);
    private static final Set<String> AMOUNT_RULE_TYPES = Set.of("maxAmountPerTransaction", "maxTotalAmount");

    private final IssuingService issuingService;
    private final CardRangeCatalog cardRangeCatalog;
    private final CardTransferService cardTransferService;
    private final UserRepository userRepository;
    private final CardRepository cardRepository;

    public IssuingController(IssuingService issuingService,
                             CardRangeCatalog cardRangeCatalog,
                             CardTransferService cardTransferService,
                             UserRepository userRepository,
                             CardRepository cardRepository) {
        this.issuingService = issuingService;
        this.cardRangeCatalog = cardRangeCatalog;
        this.cardTransferService = cardTransferService;
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
    }

    @PostMapping("/cards")
    public ResponseEntity<CardResponse> createCard(@RequestBody CreateCardRequest request) throws Exception {
        User user = userRepository.findById(request.getUserId())
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        ApiLogContext.setUserId(request.getUserId());

        if (request.getBalanceAccountId() == null || request.getBalanceAccountId().isBlank()) {
            throw new BadRequestException("Balance account is required");
        }
        if (request.getBrand() == null || request.getBrand().isBlank()) {
            throw new BadRequestException("Card network is required");
        }

        // Checked before the card exists, so a wrong currency doesn't leave a card without its limits.
        String cardCurrency = issuingService.getBalanceAccountCurrency(request.getBalanceAccountId());
        List<TransactionRuleRequest> rules = request.getTransactionRules() != null ? request.getTransactionRules() : List.of();
        for (TransactionRuleRequest rule : rules) {
            requireCardCurrency(rule.getType(), rule.getCurrencyCode(), cardCurrency);
        }

        CardRangeCatalog.CardRange cardRange = cardRangeCatalog.find(request.getBrand(), cardCurrency, user.getCountryCode())
                .orElseThrow(() -> notConfigured(request.getBrand(), cardCurrency));

        String paymentInstrumentId;
        try {
            paymentInstrumentId = issuingService.createVirtualCard(
                    cardRange,
                    request.getBalanceAccountId(),
                    request.getCardholderName(),
                    request.getEmail(),
                    request.getPhone()
            );
        } catch (ApiException e) {
            if (e.getResponseBody() == null || !e.getResponseBody().contains("No card range available")) {
                throw e;
            }
            log.warn("Adyen has no card range for {} issued in {} in {}: check adyen.issuing.card-ranges",
                    cardRange.brandVariant(), cardRange.countryCode(), cardCurrency);
            throw notConfigured(request.getBrand(), cardCurrency);
        }

        Card card = new Card();
        card.setPaymentInstrumentId(paymentInstrumentId);
        card.setUser(user);
        cardRepository.save(card);

        for (TransactionRuleRequest ruleRequest : rules) {
            if ("blockedMccs".equals(ruleRequest.getType())) {
                if (ruleRequest.getBlockedMccs() != null && !ruleRequest.getBlockedMccs().isEmpty()) {
                    issuingService.createMccBlockRule(paymentInstrumentId, ruleRequest.getBlockedMccs());
                }
            } else {
                issuingService.createTransactionRule(paymentInstrumentId, ruleRequest.getType(), ruleRequest.getValue(), cardCurrency);
            }
        }

        return ResponseEntity.ok(issuingService.getCardDetails(paymentInstrumentId));
    }

    @GetMapping("/card-networks")
    public ResponseEntity<List<CardNetworkOption>> getCardNetworks() {
        return ResponseEntity.ok(cardRangeCatalog.networks());
    }

    @GetMapping("/cards/{userId}")
    public ResponseEntity<List<CardResponse>> getCards(@PathVariable String userId, @RequestParam(required = false) String status) throws Exception {
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
            String cardCurrency = issuingService.getCardCurrency(request.getPaymentInstrumentId());
            requireCardCurrency(request.getType(), request.getCurrencyCode(), cardCurrency);
            ruleId = issuingService.createTransactionRule(request.getPaymentInstrumentId(), request.getType(), request.getValue(), cardCurrency);
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
        String encryptedData = issuingService.revealCardData(
                request.get("paymentInstrumentId"),
                request.get("encryptedKey")
        );
        return ResponseEntity.ok(Map.of("encryptedData", encryptedData));
    }

    @GetMapping("/transfers")
    public ResponseEntity<List<CardTransferDTO>> getCardTransfers(
            @RequestParam String userId,
            @RequestParam(required = false) String paymentInstrumentId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        return ResponseEntity.ok(cardTransferService.getCardTransfers(user.getAccountHolderId(), paymentInstrumentId));
    }

    @GetMapping("/relayed-auth/{userId}")
    public ResponseEntity<Map<String, Object>> getRelayedAuthConfig(@PathVariable String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        int pct = user.getApprovalPercentage() != null ? user.getApprovalPercentage() : 100;
        return ResponseEntity.ok(Map.of("approvalPercentage", pct));
    }

    @PutMapping("/relayed-auth/{userId}")
    public ResponseEntity<Map<String, Object>> updateRelayedAuthConfig(
            @PathVariable String userId,
            @RequestBody Map<String, Integer> request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        Integer pct = request.get("approvalPercentage");
        if (pct == null || pct < 0 || pct > 100) {
            throw new BadRequestException("approvalPercentage must be between 0 and 100");
        }
        user.setApprovalPercentage(pct);
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("approvalPercentage", pct));
    }

    private void requireCardCurrency(String ruleType, String requestedCurrency, String cardCurrency) {
        if (AMOUNT_RULE_TYPES.contains(ruleType) && requestedCurrency != null && !requestedCurrency.equalsIgnoreCase(cardCurrency)) {
            throw new BadRequestException("Spending limits must be in the card currency (" + cardCurrency
                    + "), the default currency of its balance account.");
        }
    }

    private static BadRequestException notConfigured(String brand, String currency) {
        String network = "visa".equalsIgnoreCase(brand) ? "Visa" : "mc".equalsIgnoreCase(brand) ? "Mastercard" : brand;
        return new BadRequestException(network + " cards aren't configured for " + currency + " balance accounts.");
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
