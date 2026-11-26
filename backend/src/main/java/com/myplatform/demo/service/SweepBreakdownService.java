package com.myplatform.demo.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.SweepBreakdownDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.util.AdyenTransfers;
import com.myplatform.demo.util.SweepBreakdown;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which movements of a balance account an automatic sweep moved, rebuilt from the Transactions API each time: it works
 * for past sweeps as well, as long as the sweep before is less than {@link #LOOKBACK} older.
 */
@Service
public class SweepBreakdownService {

    private static final Logger log = LoggerFactory.getLogger(SweepBreakdownService.class);
    private static final String TRANSFERS_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";
    private static final String TRANSACTIONS_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/transactions";
    static final Duration LOOKBACK = Duration.ofDays(31);
    /** A payment's transfer is created when it's captured, days before its transaction is booked at settlement. */
    private static final Duration TRANSFER_LOOKBACK = Duration.ofDays(7);
    /** Covers the delay between the transfer of the sweep and the booking of its transaction. */
    private static final Duration MARGIN = Duration.ofMinutes(10);
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 20;

    private final String apiKey;
    private final RestTemplate restTemplate;
    private final BankAccountResolver bankAccounts;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private record Pages(List<JsonNode> roots, boolean truncated) {
    }

    public SweepBreakdownService(@Value("${adyen.balancePlatformApiKey}") String apiKey, RestTemplate restTemplate,
                                 BankAccountResolver bankAccounts) {
        this.apiKey = apiKey;
        this.restTemplate = restTemplate;
        this.bankAccounts = bankAccounts;
    }

    public SweepBreakdownDTO breakdown(User user, String transferId) {
        if (user.getAccountHolderId() == null || user.getAccountHolderId().isBlank()) {
            throw new BadRequestException("The account has no account holder yet.");
        }
        JsonNode transfer = transfer(transferId);
        String accountHolderId = text(transfer.path("accountHolder"), "id");
        if (accountHolderId != null && !accountHolderId.equals(user.getAccountHolderId())) {
            throw new ResourceNotFoundException("Transfer not found");
        }
        String reference = text(transfer, "reference");
        if (!"internal".equals(text(transfer, "category")) || reference == null
                || !reference.startsWith(SweepBreakdown.SWEEP_REFERENCE_PREFIX)) {
            throw new BadRequestException("Only the automatic transfers between your balance accounts list the "
                    + "movements they include.");
        }
        String source = sourceAccount(user, transfer);
        long amount = Math.abs(transfer.path("amount").path("value").asLong(0));
        String currency = text(transfer.path("amount"), "currency");
        Instant createdAt = instant(text(transfer, "createdAt"));
        Instant sweptAt = createdAt != null ? createdAt : Instant.now();
        Instant windowStart = sweptAt.minus(LOOKBACK);
        Instant windowEnd = min(sweptAt.plus(MARGIN), Instant.now());
        List<String> warnings = new ArrayList<>();
        boolean complete = true;

        Pages transactionPages;
        try {
            transactionPages = pages(TRANSACTIONS_URL, source, windowStart, windowEnd);
        } catch (HttpClientErrorException.Unauthorized e) {
            throw new BadRequestException("Strong customer authentication is required to read the movements of the "
                    + "account this transfer comes from.");
        }
        List<SweepBreakdown.Transaction> transactions = new ArrayList<>();
        transactionPages.roots().forEach(root -> transactions.addAll(SweepBreakdown.page(root).transactions()));
        if (transactionPages.truncated()) {
            complete = false;
            warnings.add("The account has more than " + MAX_PAGES * PAGE_SIZE + " movements in the "
                    + LOOKBACK.toDays() + " days before this transfer: only the latest ones are listed.");
        }

        SweepBreakdown.Result result = SweepBreakdown.breakdown(transferId, reference, amount, transactions);
        if (result == null) {
            warnings.add("This transfer isn't booked on the account it comes from yet: try again in a few minutes.");
            return new SweepBreakdownDTO(transferId, source, currency, amount, sweptAt, null, null, List.of(), 0,
                    amount, false, warnings);
        }
        if (result.previousSweep() == null) {
            complete = false;
        }

        Map<String, AdyenTransfers.Movement> transfers = transfersOf(source, result.included(), windowEnd, warnings);
        List<SweepBreakdownDTO.Item> items = result.included().stream().map(t -> {
            SweepBreakdown.Description description = SweepBreakdown.describe(t, transfers.get(t.transferId()));
            return new SweepBreakdownDTO.Item(t.id(), t.transferId(), description.kind(), description.label(),
                    description.reference(), description.pspReference(), t.amount(), t.currency(), t.bookedAt(),
                    t.availableAt());
        }).toList();
        long total = result.includedTotal();
        SweepBreakdown.Transaction previous = result.previousSweep();
        return new SweepBreakdownDTO(transferId, source, currency != null ? currency : result.sweep().currency(),
                amount, result.sweep().availableAt(), previous == null ? null : previous.availableAt(),
                previous == null ? null : previous.transferId(), items, total, amount - total, complete, warnings);
    }

    private JsonNode transfer(String transferId) {
        URI uri = UriComponentsBuilder.fromUriString(TRANSFERS_URL).pathSegment(transferId).encode().build().toUri();
        try {
            return readTree(restTemplate.exchange(uri, HttpMethod.GET, request(), String.class).getBody());
        } catch (HttpClientErrorException.NotFound e) {
            throw new ResourceNotFoundException("Transfer not found");
        }
    }

    /**
     * The balance account the sweep took the money from: of the two accounts of the internal transfer, the one that
     * isn't the business account.
     */
    private String sourceAccount(User user, JsonNode transfer) {
        Set<String> accounts = new LinkedHashSet<>();
        String own = text(transfer.path("balanceAccount"), "id");
        String counterparty = text(transfer.path("counterparty"), "balanceAccountId");
        if (own != null) accounts.add(own);
        if (counterparty != null) accounts.add(counterparty);
        if (bankAccounts.hasBankAccount(user)) {
            try {
                accounts.remove(bankAccounts.balanceAccountId(user));
            } catch (Exception e) {
                log.warn("Couldn't find the business account of user {}: {}", user.getId(), e.getMessage());
            }
        }
        if (accounts.size() == 1) {
            return accounts.iterator().next();
        }
        if (user.getBalanceAccountId() != null && accounts.contains(user.getBalanceAccountId())) {
            return user.getBalanceAccountId();
        }
        throw new BadRequestException("The account this transfer comes from couldn't be found.");
    }

    /** The transfers of the movements, by id, for their kind and references. Empty when they couldn't be loaded. */
    private Map<String, AdyenTransfers.Movement> transfersOf(String balanceAccountId,
                                                             List<SweepBreakdown.Transaction> included,
                                                             Instant until, List<String> warnings) {
        Instant earliest = included.stream()
                .map(t -> t.createdAt() != null ? t.createdAt() : t.availableAt())
                .min(Comparator.naturalOrder())
                .orElse(null);
        if (earliest == null) {
            return Map.of();
        }
        try {
            Pages pages = pages(TRANSFERS_URL, balanceAccountId, earliest.minus(TRANSFER_LOOKBACK), until);
            List<AdyenTransfers.Movement> movements = new ArrayList<>();
            pages.roots().forEach(root -> movements.addAll(AdyenTransfers.page(root).movements()));
            Map<String, AdyenTransfers.Movement> byId = new HashMap<>();
            for (AdyenTransfers.Movement movement : AdyenTransfers.latest(movements)) {
                if (balanceAccountId.equals(movement.balanceAccountId())) {
                    byId.put(movement.id(), movement);
                }
            }
            return byId;
        } catch (RestClientException | IllegalStateException e) {
            log.warn("Couldn't list the transfers of balance account {}: {}", balanceAccountId, e.getMessage());
            warnings.add("The details of the movements couldn't be loaded: only their amounts are shown.");
            return Map.of();
        }
    }

    /** Every page of a list of the Transfers API, following its links. */
    private Pages pages(String url, String balanceAccountId, Instant since, Instant until) {
        URI uri = UriComponentsBuilder.fromUriString(url)
                .queryParam("balanceAccountId", balanceAccountId)
                .queryParam("createdSince", since.truncatedTo(ChronoUnit.SECONDS).toString())
                .queryParam("createdUntil", until.truncatedTo(ChronoUnit.SECONDS).toString())
                .queryParam("limit", PAGE_SIZE)
                .encode()
                .build()
                .toUri();
        List<JsonNode> roots = new ArrayList<>();
        for (int page = 1; uri != null; page++) {
            if (page > MAX_PAGES) {
                return new Pages(roots, true);
            }
            JsonNode root = readTree(restTemplate.exchange(uri, HttpMethod.GET, request(), String.class).getBody());
            roots.add(root);
            uri = nextPage(url, text(root.path("_links").path("next"), "href"));
        }
        return new Pages(roots, false);
    }

    /** The next page as Adyen links it, only followed to the same list. */
    private static URI nextPage(String url, String href) {
        if (href == null || !href.startsWith(url + "?")) {
            return null;
        }
        try {
            return new URI(href);
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private HttpEntity<Void> request() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-API-Key", apiKey);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        return new HttpEntity<>(headers);
    }

    private JsonNode readTree(String body) {
        try {
            return objectMapper.readTree(body == null || body.isBlank() ? "{}" : body);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The Transfers API returned malformed JSON", e);
        }
    }

    private static Instant min(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }

    private static Instant instant(String value) {
        try {
            return value == null ? null : java.time.OffsetDateTime.parse(value).toInstant();
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() || value.isContainerNode() ? null : value.asText();
    }
}
