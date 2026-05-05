package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.service.balanceplatform.*;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.dto.CardResponse;
import com.myplatform.demo.dto.TransactionRuleResponseDTO;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Service
public class IssuingService {

    private final ManageCardPinApi manageCardPinApi;
    private final PaymentInstrumentsApi paymentInstrumentsApi;
    private final TransactionRulesApi transactionRulesApi;
    private final BalanceAccountsApi balanceAccountsApi;
    private final String issuingCountry;
    private final String visaSubvariant;
    private final String mcSubvariant;

    public IssuingService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                          @Value("${adyen.issuing.country}") String issuingCountry,
                          @Value("${adyen.issuing.visa.subvariant}") String visaSubvariant,
                          @Value("${adyen.issuing.mastercard.subvariant}") String mcSubvariant) {
        this.manageCardPinApi = new ManageCardPinApi(balancePlatformClient);
        this.paymentInstrumentsApi = new PaymentInstrumentsApi(balancePlatformClient);
        this.transactionRulesApi = new TransactionRulesApi(balancePlatformClient);
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);

        this.issuingCountry = issuingCountry;
        this.visaSubvariant = visaSubvariant;
        this.mcSubvariant = mcSubvariant;
    }

    public String getPublicKey(String reason) throws IOException, ApiException {
        PublicKeyResponse publicKeyResponse = manageCardPinApi.publicKey(reason, "pem", null);
        return publicKeyResponse.getPublicKey();
    }

    public String createVirtualCard(String balanceAccountId, String cardholderName, String brand, String email, String phone) throws IOException, ApiException {
        String brandVariant = "visa".equalsIgnoreCase(brand) ? this.visaSubvariant : this.mcSubvariant;

        CardInfo cardInfo = new CardInfo()
                .cardholderName(cardholderName)
                .brand(brand.toLowerCase())
                .brandVariant(brandVariant)
                .formFactor(CardInfo.FormFactorEnum.VIRTUAL);

        if (email != null || phone != null) {
            Authentication authentication = new Authentication();
            if (email != null && !email.isBlank()) {
                authentication.email(email);
            }
            if (phone != null && !phone.isBlank()) {
                authentication.phone(new Phone()
                        .number(phone)
                        .type(Phone.TypeEnum.MOBILE));
            }
            authentication.setPassword("123456");
            cardInfo.authentication(authentication);
        }

        PaymentInstrumentInfo paymentInstrumentInfo = new PaymentInstrumentInfo()
                .balanceAccountId(balanceAccountId)
                .issuingCountryCode(this.issuingCountry)
                .type(PaymentInstrumentInfo.TypeEnum.CARD)
                .card(cardInfo);

        PaymentInstrument paymentInstrument = paymentInstrumentsApi.createPaymentInstrument(paymentInstrumentInfo);
        return paymentInstrument.getId();
    }

    public CardResponse getCardDetails(String paymentInstrumentId) throws IOException, ApiException {
        PaymentInstrument pi = paymentInstrumentsApi.getPaymentInstrument(paymentInstrumentId);

        CardResponse response = new CardResponse();
        response.setPaymentInstrumentId(pi.getId());
        response.setStatus(pi.getStatus() != null ? pi.getStatus().getValue() : "unknown");

        if (pi.getBalanceAccountId() != null) {
            try {
                BalanceAccount ba = balanceAccountsApi.getBalanceAccount(pi.getBalanceAccountId());
                response.setBalanceAccountDescription(ba.getDescription());
            } catch (Exception e) {
                response.setBalanceAccountDescription(pi.getBalanceAccountId());
            }
        }

        if (pi.getCard() != null) {
            response.setCardholderName(pi.getCard().getCardholderName());
            response.setBrand(pi.getCard().getBrand());
            response.setBrandVariant(pi.getCard().getBrandVariant());
            response.setLastFour(pi.getCard().getLastFour());

            if (pi.getCard().getExpiration() != null) {
                response.setExpiryMonth(pi.getCard().getExpiration().getMonth());
                response.setExpiryYear(pi.getCard().getExpiration().getYear());
            }
        }

        List<TransactionRuleResponseDTO> rules = getTransactionRulesForCard(paymentInstrumentId);
        response.setTransactionRules(rules);

        return response;
    }

    public void updateCardStatus(String paymentInstrumentId, String status) throws IOException, ApiException {
        PaymentInstrumentUpdateRequest updateRequest = new PaymentInstrumentUpdateRequest();

        switch (status.toLowerCase()) {
            case "active" -> updateRequest.setStatus(PaymentInstrumentUpdateRequest.StatusEnum.ACTIVE);
            case "suspended" -> updateRequest.setStatus(PaymentInstrumentUpdateRequest.StatusEnum.SUSPENDED);
            case "closed" -> {
                updateRequest.setStatus(PaymentInstrumentUpdateRequest.StatusEnum.CLOSED);
                updateRequest.setStatusReason(PaymentInstrumentUpdateRequest.StatusReasonEnum.ENDOFLIFE);
            }
            default -> throw new IllegalArgumentException("Invalid status: " + status);
        }

        paymentInstrumentsApi.updatePaymentInstrument(paymentInstrumentId, updateRequest);
    }

    public String createTransactionRule(String paymentInstrumentId, String type, Long value, String currencyCode) throws IOException, ApiException {
        TransactionRuleInfo ruleInfo = new TransactionRuleInfo();
        ruleInfo.setOutcomeType(TransactionRuleInfo.OutcomeTypeEnum.HARDBLOCK);
        ruleInfo.setStatus(TransactionRuleInfo.StatusEnum.ACTIVE);

        TransactionRuleEntityKey entityKey = new TransactionRuleEntityKey();
        entityKey.setEntityType("paymentInstrument");
        entityKey.setEntityReference(paymentInstrumentId);
        ruleInfo.setEntityKey(entityKey);

        TransactionRuleInterval interval = new TransactionRuleInterval();
        TransactionRuleRestrictions restrictions = new TransactionRuleRestrictions();

        switch (type) {
            case "maxTransactions" -> {
                // Use maxUsage type with matchingTransactions for limiting number of transactions
                ruleInfo.setType(TransactionRuleInfo.TypeEnum.MAXUSAGE);
                ruleInfo.setDescription("Max transactions limit: " + value);
                ruleInfo.setReference("max_tx_" + paymentInstrumentId.substring(0, 8));
                interval.setType(TransactionRuleInterval.TypeEnum.LIFETIME);

                MatchingTransactionsRestriction matchingRestriction = new MatchingTransactionsRestriction();
                matchingRestriction.setOperation("greaterThan");
                matchingRestriction.setValue(value.intValue()); // Block when transactions > N (allows exactly N transactions)
                restrictions.setMatchingTransactions(matchingRestriction);
            }
            case "maxAmountPerTransaction" -> {
                // Use velocity type with totalAmount for per-transaction amount limit
                ruleInfo.setType(TransactionRuleInfo.TypeEnum.VELOCITY);
                ruleInfo.setDescription("Max amount per transaction: " + String.format("%.2f", value / 100.0) + " " + currencyCode);
                ruleInfo.setReference("max_per_tx_" + paymentInstrumentId.substring(0, 8));
                interval.setType(TransactionRuleInterval.TypeEnum.PERTRANSACTION);

                TotalAmountRestriction totalRestriction = new TotalAmountRestriction();
                totalRestriction.setOperation("greaterThan");
                totalRestriction.setValue(new Amount().value(value).currency(currencyCode));
                restrictions.setTotalAmount(totalRestriction);
            }
            case "maxTotalAmount" -> {
                // Use maxUsage type with totalAmount for lifetime spending limit
                ruleInfo.setType(TransactionRuleInfo.TypeEnum.MAXUSAGE);
                ruleInfo.setDescription("Max total amount: " + String.format("%.2f", value / 100.0) + " " + currencyCode);
                ruleInfo.setReference("max_total_" + paymentInstrumentId.substring(0, 8));
                interval.setType(TransactionRuleInterval.TypeEnum.LIFETIME);

                TotalAmountRestriction totalRestriction = new TotalAmountRestriction();
                totalRestriction.setOperation("greaterThan");
                totalRestriction.setValue(new Amount().value(value).currency(currencyCode));
                restrictions.setTotalAmount(totalRestriction);
            }
            default -> throw new IllegalArgumentException("Invalid rule type: " + type);
        }

        ruleInfo.setInterval(interval);
        ruleInfo.setRuleRestrictions(restrictions);

        TransactionRule rule = transactionRulesApi.createTransactionRule(ruleInfo);
        return rule.getId();
    }

    public String createMccBlockRule(String paymentInstrumentId, List<String> mccs) throws IOException, ApiException {
        TransactionRuleInfo ruleInfo = new TransactionRuleInfo();
        ruleInfo.setType(TransactionRuleInfo.TypeEnum.BLOCKLIST);
        ruleInfo.setOutcomeType(TransactionRuleInfo.OutcomeTypeEnum.HARDBLOCK);
        ruleInfo.setStatus(TransactionRuleInfo.StatusEnum.ACTIVE);

        String mccList = String.join(",", mccs);
        ruleInfo.setDescription("Blocked MCCs: " + mccList);
        ruleInfo.setReference("block_mcc_" + paymentInstrumentId.substring(0, 8));

        TransactionRuleEntityKey entityKey = new TransactionRuleEntityKey();
        entityKey.setEntityType("paymentInstrument");
        entityKey.setEntityReference(paymentInstrumentId);
        ruleInfo.setEntityKey(entityKey);

        TransactionRuleInterval interval = new TransactionRuleInterval();
        interval.setType(TransactionRuleInterval.TypeEnum.PERTRANSACTION);
        ruleInfo.setInterval(interval);

        TransactionRuleRestrictions restrictions = new TransactionRuleRestrictions();
        MccsRestriction mccsRestriction = new MccsRestriction();
        mccsRestriction.setOperation("anyMatch");
        mccsRestriction.setValue(mccs);
        restrictions.setMccs(mccsRestriction);
        ruleInfo.setRuleRestrictions(restrictions);

        TransactionRule rule = transactionRulesApi.createTransactionRule(ruleInfo);
        return rule.getId();
    }

    public List<TransactionRuleResponseDTO> getTransactionRulesForCard(String paymentInstrumentId) throws IOException, ApiException {
        TransactionRulesResponse rulesResponse = paymentInstrumentsApi.getAllTransactionRulesForPaymentInstrument(paymentInstrumentId);

        List<TransactionRuleResponseDTO> result = new ArrayList<>();

        if (rulesResponse.getTransactionRules() != null) {
            for (TransactionRule rule : rulesResponse.getTransactionRules()) {
                TransactionRuleResponseDTO dto = new TransactionRuleResponseDTO();
                dto.setId(rule.getId());
                dto.setStatus(rule.getStatus() != null ? rule.getStatus().getValue() : "active");

                String description = rule.getDescription();
                if (description != null) {
                    if (description.contains("Max transactions")) {
                        dto.setType("maxTransactions");
                    } else if (description.contains("Max amount per transaction")) {
                        dto.setType("maxAmountPerTransaction");
                    } else if (description.contains("Max total amount")) {
                        dto.setType("maxTotalAmount");
                    } else if (description.contains("Blocked MCCs")) {
                        dto.setType("blockedMccs");
                    }
                }

                if (rule.getRuleRestrictions() != null) {
                    // Handle totalAmount for amount-based rules
                    if (rule.getRuleRestrictions().getTotalAmount() != null) {
                        Amount maxAmount = rule.getRuleRestrictions().getTotalAmount().getValue();
                        if (maxAmount != null) {
                            dto.setValue(maxAmount.getValue());
                            dto.setCurrencyCode(maxAmount.getCurrency());
                        }
                    }
                    // Handle matchingTransactions for maxTransactions rule
                    if (rule.getRuleRestrictions().getMatchingTransactions() != null) {
                        Integer txValue = rule.getRuleRestrictions().getMatchingTransactions().getValue();
                        if (txValue != null) {
                            dto.setValue(txValue.longValue());
                        }
                    }
                    // Handle mccs for blockedMccs rule
                    if (rule.getRuleRestrictions().getMccs() != null) {
                        List<String> mccs = rule.getRuleRestrictions().getMccs().getValue();
                        if (mccs != null) {
                            dto.setBlockedMccs(mccs);
                        }
                    }
                }

                // Only add rules that we can properly display (have a recognized type)
                if (dto.getType() != null) {
                    result.add(dto);
                }
            }
        }

        return result;
    }

    public void updateTransactionRule(String ruleId, String status) throws IOException, ApiException {
        TransactionRuleInfo updateInfo = new TransactionRuleInfo();

        if ("active".equalsIgnoreCase(status)) {
            updateInfo.setStatus(TransactionRuleInfo.StatusEnum.ACTIVE);
        } else if ("inactive".equalsIgnoreCase(status)) {
            updateInfo.setStatus(TransactionRuleInfo.StatusEnum.INACTIVE);
        }

        transactionRulesApi.updateTransactionRule(ruleId, updateInfo);
    }

    public void deleteTransactionRule(String ruleId) throws IOException, ApiException {
        transactionRulesApi.deleteTransactionRule(ruleId);
    }

    public String revealCardData(String paymentInstrumentId, String encryptedKey) throws Exception {
        PaymentInstrumentRevealRequest revealRequest = new PaymentInstrumentRevealRequest()
                .encryptedKey(encryptedKey)
                .paymentInstrumentId(paymentInstrumentId);

        PaymentInstrumentRevealResponse revealResponse = paymentInstrumentsApi.revealDataOfPaymentInstrument(revealRequest);
        return revealResponse.getEncryptedData();
    }
}
