package com.myplatform.demo.service;

import com.adyen.model.management.Terminal;
import com.adyen.model.management.TerminalAssignment;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.dto.InvoiceTerminalDTO;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.model.TerminalResponse;
import com.myplatform.demo.repository.StoreCustomerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Which user a terminal collects the payments of invoices for: the user of the store it's assigned to. The terminal
 * app asks at each request, so the answer is kept for 5 minutes.
 */
@Service
public class TerminalDirectory {

    private static final Logger log = LoggerFactory.getLogger(TerminalDirectory.class);
    private static final Duration TTL = Duration.ofMinutes(5);
    /** A terminal that isn't found yet may be assigned in a moment. */
    private static final Duration UNKNOWN_TTL = Duration.ofSeconds(30);
    private static final int MAX_ENTRIES = 1000;
    /** A POIID, e.g. "S1F2-000158234567890". */
    private static final Pattern TERMINAL_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{2,49}$");
    private static final String BOARDED = TerminalAssignment.StatusEnum.BOARDED.getValue();

    /** A terminal, and the store and user it's assigned to. */
    public record Owner(String terminalId, String model, String storeId, String storeReference, String storeCity,
                        String userId) {
    }

    private record Entry(Owner owner, Instant expiresAt) {
    }

    private final StoreManagementService storeManagementService;
    private final StoreCustomerRepository storeCustomerRepository;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    public TerminalDirectory(StoreManagementService storeManagementService,
                             StoreCustomerRepository storeCustomerRepository) {
        this.storeManagementService = storeManagementService;
        this.storeCustomerRepository = storeCustomerRepository;
    }

    public static boolean validId(String terminalId) {
        return terminalId != null && TERMINAL_ID.matcher(terminalId).matches();
    }

    /** The store and user of the terminal, empty when it isn't assigned to a store of a user. */
    public Optional<Owner> owner(String terminalId) {
        if (!validId(terminalId)) {
            return Optional.empty();
        }
        String key = terminalId.toUpperCase(Locale.ROOT);
        Instant now = Instant.now();
        Entry entry = cache.get(key);
        if (entry != null && entry.expiresAt().isAfter(now)) {
            return Optional.ofNullable(entry.owner());
        }
        Owner owner = lookUp(terminalId);
        remember(key, new Entry(owner, now.plus(owner != null ? TTL : UNKNOWN_TTL)), now);
        return Optional.ofNullable(owner);
    }

    /** The terminals boarded in the stores of the user, store by store. */
    public List<InvoiceTerminalDTO> terminalsOf(String userId) {
        List<InvoiceTerminalDTO> terminals = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        Instant now = Instant.now();
        for (StoreCustomer store : storeCustomerRepository.findByUserIdOrderByIdAsc(userId)) {
            if (store.getStoreId() == null || store.getStoreId().isBlank()) {
                continue;
            }
            List<TerminalResponse> found;
            try {
                found = storeManagementService.listTerminals(store.getStoreId());
            } catch (IOException | ApiException e) {
                log.warn("Couldn't list the terminals of store {}: {}", store.getStoreId(), e.getMessage());
                failed.add(store.getStoreRef() != null ? store.getStoreRef() : store.getStoreId());
                continue;
            }
            for (TerminalResponse terminal : found) {
                if (terminal.getId() == null || !BOARDED.equalsIgnoreCase(terminal.getStatus())) {
                    continue;
                }
                Owner owner = owner(terminal.getId(), terminal.getModel(), store);
                remember(terminal.getId().toUpperCase(Locale.ROOT), new Entry(owner, now.plus(TTL)), now);
                terminals.add(new InvoiceTerminalDTO(owner.terminalId(), owner.model(), owner.storeId(),
                        owner.storeReference(), owner.storeCity()));
            }
        }
        if (terminals.isEmpty() && !failed.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Couldn't load the terminals of " + String.join(", ", failed) + ". Try again in a moment.");
        }
        return terminals;
    }

    private Owner lookUp(String terminalId) {
        Terminal terminal;
        try {
            terminal = storeManagementService.findTerminal(terminalId).orElse(null);
        } catch (IOException | ApiException e) {
            log.warn("Couldn't look up terminal {}: {}", terminalId, e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Couldn't look up the terminal. Try again in a moment.");
        }
        if (terminal == null || terminal.getAssignment() == null || terminal.getAssignment().getStoreId() == null) {
            return null;
        }
        String id = terminal.getId();
        String model = terminal.getModel();
        return storeCustomerRepository.findByStoreId(terminal.getAssignment().getStoreId())
                .filter(store -> store.getUser() != null)
                .map(store -> owner(id, model, store))
                .orElse(null);
    }

    private static Owner owner(String terminalId, String model, StoreCustomer store) {
        return new Owner(terminalId, model, store.getStoreId(), store.getStoreRef(), store.getCity(),
                store.getUser() != null ? store.getUser().getId() : null);
    }

    private void remember(String key, Entry entry, Instant now) {
        if (cache.size() >= MAX_ENTRIES) {
            cache.values().removeIf(cached -> !cached.expiresAt().isAfter(now));
        }
        cache.put(key, entry);
    }
}
