package com.myplatform.demo.service;

import com.adyen.model.balanceplatform.BalanceAccountBase;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.LedgerDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.CardExpense;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.BillRepository;
import com.myplatform.demo.repository.CardExpenseRepository;
import com.myplatform.demo.repository.InvoiceRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.AdyenTransfers;
import com.myplatform.demo.util.JournalCsv;
import com.myplatform.demo.util.LedgerAccounts;
import com.myplatform.demo.util.LedgerRules;
import com.myplatform.demo.util.VatRates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The accounting journal of a user: the invoices they issued, the bills of their suppliers, and the movements of their
 * balance accounts that the Transfers API lists, matched with these documents and with the card payments they
 * classified. Nothing else is stored: the journal is built again from Adyen each time.
 */
@Service
public class LedgerService {

    private static final Logger log = LoggerFactory.getLogger(LedgerService.class);

    public static final int DEFAULT_DAYS = 30;
    public static final int MAX_DAYS = 90;
    private static final String TRANSFERS_URL = "https://balanceplatform-api-test.adyen.com/btl/v4/transfers";
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 20;
    /** A transfer can be booked days after it was created, e.g. a card payment captured after its authorisation. */
    private static final int LOOKBACK_DAYS = 7;
    private static final String BUSINESS_ACCOUNT = "Business Bank Account";

    private final UserRepository userRepository;
    private final InvoiceRepository invoiceRepository;
    private final BillRepository billRepository;
    private final CardExpenseRepository cardExpenseRepository;
    private final BalanceAccountService balanceAccountService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String apiKey;

    /** The journal as a CSV file, and the name to save it under. */
    public record JournalExport(byte[] content, String fileName) {
    }

    public LedgerService(@Value("${adyen.balancePlatformApiKey}") String apiKey,
                         RestTemplate restTemplate,
                         ObjectMapper objectMapper,
                         UserRepository userRepository,
                         InvoiceRepository invoiceRepository,
                         BillRepository billRepository,
                         CardExpenseRepository cardExpenseRepository,
                         BalanceAccountService balanceAccountService) {
        this.apiKey = apiKey;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
        this.invoiceRepository = invoiceRepository;
        this.billRepository = billRepository;
        this.cardExpenseRepository = cardExpenseRepository;
        this.balanceAccountService = balanceAccountService;
    }

    /** The journal of the last days, today included. */
    public LedgerDTO ledger(String userId, Integer days) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        int period = period(days);
        LocalDate to = LocalDate.now(ZoneOffset.UTC);
        LocalDate from = to.minusDays(period - 1L);
        List<String> warnings = new ArrayList<>();
        List<Invoice> invoices = invoiceRepository.findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId);
        List<Bill> bills = billRepository.findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId);
        List<CardExpense> expenses = cardExpenseRepository.findByUserId(userId);
        List<AdyenTransfers.Movement> movements = List.of();
        Map<String, LedgerRules.OwnAccount> balanceAccounts = Map.of();
        boolean loaded = false;
        String accountHolderId = user.getAccountHolderId();
        if (accountHolderId == null || accountHolderId.isBlank()) {
            warnings.add("The account has no account holder yet, so the journal only has the invoices and the bills.");
        } else {
            List<BalanceAccountBase> listed = listBalanceAccounts(accountHolderId, warnings);
            try {
                movements = movements(accountHolderId, from.minusDays(LOOKBACK_DAYS), warnings);
                loaded = true;
            } catch (HttpStatusCodeException e) {
                log.warn("Couldn't list the transfers of account holder {}: HTTP {}", accountHolderId,
                        e.getStatusCode().value());
                warnings.add("The account movements couldn't be loaded (HTTP " + e.getStatusCode().value()
                        + "): the journal only has the invoices and the bills.");
            } catch (RestClientException | IllegalStateException e) {
                log.warn("Couldn't list the transfers of account holder {}: {}", accountHolderId, e.getMessage());
                warnings.add("The account movements couldn't be read: the journal only has the invoices and the bills.");
            }
            balanceAccounts = ownAccounts(user, listed, movements);
        }
        return LedgerRules.build(new LedgerRules.Input(from, to, InvoiceService.currency(user),
                        VatRates.taxLabel(user.getCountryCode()), invoices, bills, expenses, movements,
                        balanceAccounts),
                loaded, warnings, Instant.now());
    }

    public JournalExport export(String userId, Integer days) {
        LedgerDTO ledger = ledger(userId, days);
        return new JournalExport(JournalCsv.write(ledger.entries()),
                "journal-" + ledger.from() + "-to-" + ledger.to() + ".csv");
    }

    private static int period(Integer days) {
        if (days == null) {
            return DEFAULT_DAYS;
        }
        if (days < 1 || days > MAX_DAYS) {
            throw new BadRequestException("The period must be between 1 and " + MAX_DAYS + " days.");
        }
        return days;
    }

    private List<BalanceAccountBase> listBalanceAccounts(String accountHolderId, List<String> warnings) {
        try {
            return balanceAccountService.listBalanceAccounts(accountHolderId);
        } catch (Exception e) {
            log.warn("Couldn't list the balance accounts of account holder {}: {}", accountHolderId, e.getMessage());
            warnings.add("Couldn't read the names of the balance accounts, so their sub-accounts are named after "
                    + "their ids.");
            return List.of();
        }
    }

    /** The transfers created since the day, as movements, following the pages of the Transfers API. */
    private List<AdyenTransfers.Movement> movements(String accountHolderId, LocalDate since, List<String> warnings) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-API-Key", apiKey);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        HttpEntity<Void> request = new HttpEntity<>(headers);
        URI uri = UriComponentsBuilder.fromUriString(TRANSFERS_URL)
                .queryParam("accountHolderId", accountHolderId)
                .queryParam("createdSince", since.atStartOfDay(ZoneOffset.UTC).toInstant().toString())
                .queryParam("createdUntil", Instant.now().truncatedTo(ChronoUnit.SECONDS).toString())
                .queryParam("limit", PAGE_SIZE)
                .encode()
                .build()
                .toUri();
        List<AdyenTransfers.Movement> movements = new ArrayList<>();
        for (int page = 1; uri != null; page++) {
            if (page > MAX_PAGES) {
                warnings.add("The period has more than " + MAX_PAGES * PAGE_SIZE
                        + " movements: the journal only has the first ones.");
                break;
            }
            String body = restTemplate.exchange(uri, HttpMethod.GET, request, String.class).getBody();
            AdyenTransfers.Page result = AdyenTransfers.page(readTree(body));
            movements.addAll(result.movements());
            uri = nextPage(result.next());
            if (result.next() != null && uri == null) {
                warnings.add("The next movements couldn't be loaded: the journal only has the first ones.");
            }
        }
        return AdyenTransfers.latest(movements);
    }

    private JsonNode readTree(String body) {
        try {
            return objectMapper.readTree(body == null || body.isBlank() ? "{}" : body);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The Transfers API returned malformed JSON", e);
        }
    }

    /** The next page as Adyen links it, only followed to the Transfers API itself. */
    private static URI nextPage(String href) {
        if (href == null || !href.startsWith(TRANSFERS_URL + "?")) {
            return null;
        }
        try {
            return new URI(href);
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /**
     * The balance accounts of the account holder by id, the main one first, each with its sub-account. When they
     * couldn't be listed, those of the movements are named after their id.
     */
    private static Map<String, LedgerRules.OwnAccount> ownAccounts(User user, List<BalanceAccountBase> listed,
                                                                 List<AdyenTransfers.Movement> movements) {
        Map<String, String> descriptions = new LinkedHashMap<>();
        Set<String> business = new HashSet<>();
        String main = user.getBalanceAccountId();
        if (main != null && !main.isBlank()) {
            descriptions.put(main, null);
        }
        for (BalanceAccountBase account : listed) {
            descriptions.put(account.getId(), account.getDescription());
            if (BUSINESS_ACCOUNT.equals(account.getDescription())) {
                business.add(account.getId());
            }
        }
        for (AdyenTransfers.Movement movement : movements) {
            descriptions.putIfAbsent(movement.balanceAccountId(), null);
        }
        Map<String, Integer> sameDescription = new HashMap<>();
        descriptions.values().stream()
                .filter(description -> description != null && !description.isBlank())
                .forEach(description -> sameDescription.merge(description, 1, Integer::sum));
        Map<String, LedgerRules.OwnAccount> accounts = new LinkedHashMap<>();
        int index = 0;
        for (Map.Entry<String, String> account : descriptions.entrySet()) {
            String id = account.getKey();
            String description = account.getValue();
            String name = description == null || description.isBlank() ? id
                    : sameDescription.get(description) > 1 ? description + " (" + id + ")" : description;
            accounts.put(id, new LedgerRules.OwnAccount(id, name, business.contains(id),
                    LedgerAccounts.balanceAccount(index++, name)));
        }
        return accounts;
    }
}
