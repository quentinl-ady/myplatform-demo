package com.myplatform.demo.service;

import com.adyen.service.exception.ApiException;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.InvoiceTerminalDTO;
import com.myplatform.demo.dto.TerminalContextDTO;
import com.myplatform.demo.dto.TerminalResultDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.TerminalOutcome;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Collects and refunds the payments of invoices at the terminals of the stores of their user: for the Invoices page,
 * which chooses the terminal, and for the app that runs on the terminal, which knows only its own ID. A request waits
 * for the terminal, up to 3 minutes. Meanwhile, the invoice can't be paid, refunded, sent or voided otherwise.
 */
@Service
public class InvoiceTerminalService {

    private static final Logger log = LoggerFactory.getLogger(InvoiceTerminalService.class);
    /** The invoices the terminal app shows: those to collect, and the paid ones. */
    private static final Set<String> APP_STATUSES = Set.of("SENT", "OVERDUE", "PAID");
    private static final String UNEXPECTED =
            "Something went wrong while waiting for the terminal. Check its screen before trying again.";

    private final InvoiceService invoiceService;
    private final TerminalDirectory terminalDirectory;
    private final PosService posService;
    private final SubscriptionService subscriptionService;
    private final UserRepository userRepository;

    public InvoiceTerminalService(InvoiceService invoiceService,
                                  TerminalDirectory terminalDirectory,
                                  PosService posService,
                                  SubscriptionService subscriptionService,
                                  UserRepository userRepository) {
        this.invoiceService = invoiceService;
        this.terminalDirectory = terminalDirectory;
        this.posService = posService;
        this.subscriptionService = subscriptionService;
        this.userRepository = userRepository;
    }

    // ---------- Invoices page ----------

    /** The terminals boarded in the stores of the user. */
    public List<InvoiceTerminalDTO> terminals(String userId) {
        user(userId);
        return terminalDirectory.terminalsOf(userId);
    }

    public TerminalResultDTO pay(String userId, Long invoiceId, String terminalId) {
        return collect(terminalOf(userId, terminalId), invoiceId);
    }

    public TerminalResultDTO refund(String userId, Long invoiceId, String terminalId) {
        return refund(terminalOf(userId, terminalId), invoiceId);
    }

    /**
     * Asks the terminal to stop waiting for the card. The pending payment then ends as cancelled, unless the customer
     * has just paid.
     */
    public void cancel(String userId, Long invoiceId) {
        InvoiceService.TerminalOperation payment = invoiceService.terminalPayment(userId, invoiceId)
                .orElseThrow(() -> new ConflictException("No terminal is collecting the payment of this invoice."));
        String rejection;
        try {
            rejection = posService.abortPayment(payment.terminalId(), payment.serviceId());
        } catch (IOException | ApiException e) {
            log.warn("Couldn't cancel the payment of invoice {} at terminal {}: {}", payment.number(),
                    payment.terminalId(), e.getMessage());
            rejection = "Couldn't reach the terminal. Cancel the payment on its screen.";
        }
        if (rejection != null) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, rejection);
        }
    }

    // ---------- Terminal app ----------

    /** The store the terminal is assigned to, and the business it collects the invoices of. */
    public TerminalContextDTO context(String terminalId) {
        TerminalDirectory.Owner terminal = assigned(terminalId);
        User user = user(terminal.userId());
        return new TerminalContextDTO(terminal.terminalId(), terminal.model(), terminal.storeId(),
                terminal.storeReference(), terminal.storeCity(), user.getId(), companyName(user),
                InvoiceService.currency(user));
    }

    /** The invoices to collect, and the paid ones, the latest first. */
    public List<InvoiceDTO> invoices(String terminalId) {
        TerminalDirectory.Owner terminal = assigned(terminalId);
        return invoiceService.list(terminal.userId()).stream()
                .filter(invoice -> APP_STATUSES.contains(invoice.status()))
                .toList();
    }

    public InvoiceDTO invoice(String terminalId, Long invoiceId) {
        TerminalDirectory.Owner terminal = assigned(terminalId);
        InvoiceDTO invoice = invoiceService.get(terminal.userId(), invoiceId);
        if (!APP_STATUSES.contains(invoice.status())) {
            throw new ResourceNotFoundException("Invoice not found");
        }
        return invoice;
    }

    public TerminalResultDTO collectAt(String terminalId, Long invoiceId) {
        return collect(assigned(terminalId), invoiceId);
    }

    public TerminalResultDTO refundAt(String terminalId, Long invoiceId) {
        return refund(assigned(terminalId), invoiceId);
    }

    // ---------- Payments and refunds ----------

    private TerminalResultDTO collect(TerminalDirectory.Owner terminal, Long invoiceId) {
        InvoiceService.TerminalOperation payment =
                invoiceService.startTerminalPayment(terminal.userId(), invoiceId, terminal.terminalId());
        TerminalOutcome outcome = await(payment, () -> posService.pay(payment.terminalId(), payment.serviceId(),
                payment.number(), payment.amount(), payment.currency()));
        InvoiceDTO invoice = invoiceService.finishTerminalOperation(payment, outcome);
        String message = outcome.message();
        if (outcome.result() == TerminalOutcome.Result.APPROVED) {
            if (invoice.subscriptionId() != null) {
                subscriptionService.sync(invoice.subscriptionId());
            }
            if (outcome.pspReference() != null && !outcome.pspReference().equals(invoice.pspReference())) {
                message = "The invoice was paid otherwise in the meantime, so the customer paid twice. Refund this payment.";
            }
        }
        return new TerminalResultDTO(outcome.result().name(), message, outcome.cardBrand(), outcome.maskedPan(),
                outcome.pspReference(), invoice);
    }

    private TerminalResultDTO refund(TerminalDirectory.Owner terminal, Long invoiceId) {
        InvoiceService.TerminalOperation refund =
                invoiceService.startTerminalRefund(terminal.userId(), invoiceId, terminal.terminalId());
        TerminalOutcome outcome = await(refund, () -> posService.reverse(refund.terminalId(), refund.serviceId(),
                refund.number(), refund.original(), refund.amount(), refund.currency()));
        InvoiceDTO invoice = invoiceService.finishTerminalOperation(refund, outcome);
        String result = switch (outcome.result()) {
            case APPROVED -> "REQUESTED";
            case DECLINED, CANCELLED -> "DECLINED";
            case ERROR -> "ERROR";
            case UNKNOWN -> "UNKNOWN";
        };
        return new TerminalResultDTO(result, outcome.message(), null, null, outcome.pspReference(), invoice);
    }

    /** Asks the terminal, and waits for its answer. After an unexpected failure, nobody knows if the card was charged. */
    private TerminalOutcome await(InvoiceService.TerminalOperation operation, Supplier<TerminalOutcome> request) {
        try {
            return Objects.requireNonNull(request.get(), "no outcome");
        } catch (RuntimeException e) {
            log.error("The {} of invoice {} at terminal {} failed", operation.kind(), operation.number(),
                    operation.terminalId(), e);
            return TerminalOutcome.of(TerminalOutcome.Result.UNKNOWN, UNEXPECTED);
        }
    }

    // ---------- Terminals ----------

    /** The terminal, when it's assigned to a store of the user. */
    private TerminalDirectory.Owner terminalOf(String userId, String terminalId) {
        user(userId);
        if (terminalId == null || terminalId.isBlank()) {
            throw new BadRequestException("Choose a terminal.");
        }
        return terminalDirectory.owner(terminalId.trim())
                .filter(terminal -> userId.equals(terminal.userId()))
                .orElseThrow(() -> new ResourceNotFoundException("This terminal isn't in one of your stores."));
    }

    /** The terminal the app runs on, when it's assigned to a store of a user: its API calls are logged for that user. */
    private TerminalDirectory.Owner assigned(String terminalId) {
        TerminalDirectory.Owner terminal = terminalDirectory.owner(terminalId)
                .orElseThrow(() -> new ResourceNotFoundException("This terminal isn't assigned to a store of the platform."));
        ApiLogContext.setUserId(terminal.userId());
        return terminal;
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private static String companyName(User user) {
        if (user.getLegalEntityName() != null && !user.getLegalEntityName().isBlank()) {
            return user.getLegalEntityName().trim();
        }
        String name = (Objects.toString(user.getFirstName(), "") + " " + Objects.toString(user.getLastName(), "")).trim();
        return name.isEmpty() ? null : name;
    }
}
