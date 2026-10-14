package com.myplatform.demo.service;

import com.adyen.model.balanceplatform.BankAccount;
import com.adyen.model.balanceplatform.BankAccountAccountIdentification;
import com.adyen.model.balanceplatform.Counterparty;
import com.adyen.model.balanceplatform.IbanAccountIdentification;
import com.adyen.model.balanceplatform.TransferRouteRequest;
import com.adyen.model.balanceplatform.UKLocalAccountIdentification;
import com.adyen.model.balanceplatform.USLocalAccountIdentification;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.RecipientCountry;
import com.myplatform.demo.model.TransferRequest;
import com.myplatform.demo.model.TransferRouteOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class TransferRouteService {

    private static final String CALCULATE_URL = "https://balanceplatform-api-test.adyen.com/bcl/v2/transferRoutes/calculate";

    // Cheapest first: the first available speed is the default one.
    private static final List<String> BANK_PRIORITIES = List.of("regular", "fast", "instant");

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String balancePlatformApiKey;
    private final String balancePlatform;

    public TransferRouteService(RestTemplate restTemplate,
                                ObjectMapper objectMapper,
                                @Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey,
                                @Value("${adyen.balancePlatform}") String balancePlatform) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.balancePlatformApiKey = balancePlatformApiKey;
        this.balancePlatform = balancePlatform;
    }

    public List<TransferRouteOption> calculateRoutes(String balanceAccountId,
                                                     RecipientCountry recipientCountry,
                                                     TransferRequest beneficiary) throws IOException {
        TransferRouteRequest routeRequest = new TransferRouteRequest()
                .balancePlatform(balancePlatform)
                .balanceAccountId(balanceAccountId)
                .category(TransferRouteRequest.CategoryEnum.BANK)
                // Adyen expects either a counterparty or a country, not both: sending the country
                // next to a bank account counterparty fails with 422 "Invalid country provided".
                .currency(recipientCountry.getCurrency())
                .counterparty(new Counterparty().bankAccount(
                        new BankAccount().accountIdentification(accountIdentification(recipientCountry, beneficiary))))
                .priorities(BANK_PRIORITIES.stream().map(TransferRouteRequest.PrioritiesEnum::fromValue).toList());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-API-Key", balancePlatformApiKey);

        String responseBody;
        try {
            responseBody = restTemplate.exchange(CALCULATE_URL, HttpMethod.POST,
                    new HttpEntity<>(routeRequest.toJson(), headers), String.class).getBody();
        } catch (HttpClientErrorException e) {
            throw new BadRequestException("Adyen could not calculate the transfer routes: " + adyenErrorDetail(e));
        }
        return toOptions(responseBody);
    }

    public void requireEligible(String balanceAccountId,
                                RecipientCountry recipientCountry,
                                TransferRequest request) throws IOException {
        String priority = request.getTransferType();
        if (!BANK_PRIORITIES.contains(priority)) {
            throw new BadRequestException("Unsupported transfer speed: " + priority);
        }
        if (request.getAmount() == null) {
            throw new BadRequestException("Amount is required");
        }

        TransferRouteOption route = calculateRoutes(balanceAccountId, recipientCountry, request).stream()
                .filter(option -> option.getPriority().equals(priority))
                .findFirst()
                .orElseThrow(() -> new BadRequestException(
                        StringUtils.capitalize(priority) + " transfers are not available for this beneficiary"));

        long amount = request.getAmount();
        String currency = recipientCountry.getCurrency();
        if (route.getMinAmount() != null && amount < route.getMinAmount()) {
            throw new BadRequestException("The minimum amount for " + priority + " transfers to this beneficiary is "
                    + formatAmount(route.getMinAmount(), currency));
        }
        if (route.getMaxAmount() != null && amount > route.getMaxAmount()) {
            throw new BadRequestException("The maximum amount for " + priority + " transfers to this beneficiary is "
                    + formatAmount(route.getMaxAmount(), currency));
        }
        // Every recipient currency (EUR, GBP, USD) has two decimals.
        if (route.isWholeAmountsOnly() && amount % 100 != 0) {
            throw new BadRequestException(StringUtils.capitalize(priority)
                    + " transfers to this beneficiary only accept whole amounts");
        }
    }

    private static BankAccountAccountIdentification accountIdentification(RecipientCountry recipientCountry,
                                                                          TransferRequest beneficiary) {
        return switch (recipientCountry.getBankAccountFormat()) {
            case "iban" -> new BankAccountAccountIdentification(new IbanAccountIdentification()
                    .type(IbanAccountIdentification.TypeEnum.IBAN)
                    .iban(beneficiary.getIban()));
            case "accountNumberSortCode" -> new BankAccountAccountIdentification(new UKLocalAccountIdentification()
                    .type(UKLocalAccountIdentification.TypeEnum.UKLOCAL)
                    .accountNumber(beneficiary.getAccountNumber())
                    .sortCode(beneficiary.getSortCode()));
            case "accountNumberRoutingNumber" -> new BankAccountAccountIdentification(new USLocalAccountIdentification()
                    .type(USLocalAccountIdentification.TypeEnum.USLOCAL)
                    .accountNumber(beneficiary.getAccountNumber())
                    .routingNumber(beneficiary.getRoutingNumber()));
            default -> throw new IllegalStateException("Unsupported bank account format: " + recipientCountry.getBankAccountFormat());
        };
    }

    // Parsed as plain JSON: the Adyen library rejects the whole response when a route lists
    // a requirement type it does not know yet, and Adyen keeps adding new ones.
    private List<TransferRouteOption> toOptions(String responseBody) throws IOException {
        if (responseBody == null || responseBody.isBlank()) {
            return List.of();
        }

        Map<String, TransferRouteOption> byPriority = new LinkedHashMap<>();
        for (JsonNode route : objectMapper.readTree(responseBody).path("transferRoutes")) {
            String priority = route.path("priority").asText();
            if (BANK_PRIORITIES.contains(priority)) {
                byPriority.putIfAbsent(priority, toOption(priority, route.path("requirements")));
            }
        }
        return BANK_PRIORITIES.stream().filter(byPriority::containsKey).map(byPriority::get).toList();
    }

    private static TransferRouteOption toOption(String priority, JsonNode requirements) {
        Long minAmount = null;
        Long maxAmount = null;
        boolean wholeAmountsOnly = false;
        List<String> otherRequirements = new ArrayList<>();

        for (JsonNode requirement : requirements) {
            switch (requirement.path("type").asText()) {
                case "amountMinMaxRequirement" -> {
                    minAmount = requirement.hasNonNull("min") ? requirement.get("min").asLong() : null;
                    maxAmount = requirement.hasNonNull("max") ? requirement.get("max").asLong() : null;
                }
                case "amountNonZeroDecimalsRequirement" -> wholeAmountsOnly = true;
                default -> {
                    String description = requirement.path("description").asText("");
                    if (!description.isBlank()) {
                        otherRequirements.add(description);
                    }
                }
            }
        }
        return new TransferRouteOption(priority, minAmount, maxAmount, wholeAmountsOnly, otherRequirements);
    }

    private String adyenErrorDetail(HttpClientErrorException e) {
        try {
            JsonNode error = objectMapper.readTree(e.getResponseBodyAsString());
            String detail = error.path("detail").asText("");
            return detail.isBlank() ? error.path("title").asText(e.getStatusText()) : detail;
        } catch (IOException parseError) {
            return e.getStatusText();
        }
    }

    private static String formatAmount(long minorUnits, String currency) {
        return BigDecimal.valueOf(minorUnits, 2).toPlainString() + " " + currency;
    }
}
