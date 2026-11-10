package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.recurring.Recurring;
import com.adyen.model.recurring.RecurringDetail;
import com.adyen.model.recurring.RecurringDetailWrapper;
import com.adyen.model.recurring.RecurringDetailsRequest;
import com.adyen.model.recurring.RecurringDetailsResult;
import com.adyen.service.exception.ApiException;
import com.adyen.service.recurring.RecurringApi;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.InvoiceRequest;
import com.myplatform.demo.dto.SubscriptionChargeRequest;
import com.myplatform.demo.dto.SubscriptionDTO;
import com.myplatform.demo.dto.SubscriptionRequest;
import com.myplatform.demo.dto.SubscriptionSettingsDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Customer;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.InvoiceEvent;
import com.myplatform.demo.model.Subscription;
import com.myplatform.demo.model.SubscriptionEvent;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CustomerRepository;
import com.myplatform.demo.repository.InvoiceRepository;
import com.myplatform.demo.repository.SubscriptionRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.InvoiceMath;
import com.myplatform.demo.util.PaymentLinks;
import com.myplatform.demo.util.PaymentMethodNames;
import com.myplatform.demo.util.SubscriptionCycles;
import com.myplatform.demo.util.VatRates;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * Subscriptions: a plan a customer pays every month or every year, with an invoice per billing cycle. The customer
 * pays the first invoice with a payment link that stores their payment method; the next invoices are charged to it,
 * without them. A refused charge makes the subscription past due, until its invoice is paid.
 */
@Service
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    /** The rescue window Adyen recommends: a month. */
    static final int DEFAULT_RESCUE_DAYS = 30;
    /** The longest rescue window Adyen accepts for a card. */
    static final int MAX_RESCUE_DAYS = 48;
    /** The customer has a week to pay the first invoice, which starts the subscription. */
    private static final int FIRST_INVOICE_TERMS_DAYS = 7;
    /** How often Adyen is asked for the payment method a paid invoice stored, until it reports it. */
    private static final Duration PAYMENT_METHOD_CHECK_INTERVAL = Duration.ofSeconds(15);
    /**
     * How long after an invoice is paid with its payment link Adyen is asked for the payment method the payment stored.
     * Adyen stores it within moments: past that, the customer paid with a payment method that can't be stored, or with
     * the one already stored.
     */
    private static final Duration PAYMENT_METHOD_WAIT = Duration.ofHours(1);
    private static final long MAX_PRICE = 100_000_000_000L;
    private static final int MAX_PLAN = 120;
    private static final int MAX_EVENT_DETAIL = 500;
    private static final long MAX_START_DAYS = 366;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final String SEPA_DIRECT_DEBIT = "sepadirectdebit";
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    /** TEST only: how the charge of a billing cycle ends. */
    private enum TestOutcome {
        REFUSED("2", null),
        EXPIRED_CARD("6", null),
        NOT_ENOUGH_BALANCE("12", null),
        RESCUED_FIRST_RETRY(null, "AutoRescueSuccessfulFirst"),
        RESCUED_SECOND_RETRY(null, "AutoRescueSuccessfulSecond"),
        NOT_RESCUED(null, "AutoRescueFailed"),
        FRAUD(null, "AutoRescueFraud");

        /** The RequestedTestAcquirerResponseCode that has the card refused. */
        private final String responseCode;
        /** The autoRescueScenario Adyen plays: the charge is refused, then retried as the scenario says. */
        private final String rescueScenario;

        TestOutcome(String responseCode, String rescueScenario) {
            this.responseCode = responseCode;
            this.rescueScenario = rescueScenario;
        }
    }

    /** A subscription as stored now, with its invoices. */
    private record State(Subscription subscription, List<Invoice> invoices) {
    }

    private final SubscriptionRepository subscriptionRepository;
    private final InvoiceRepository invoiceRepository;
    private final CustomerRepository customerRepository;
    private final UserRepository userRepository;
    private final InvoiceService invoiceService;
    private final EntityManager entityManager;
    private final RecurringApi recurringApi;
    private final String merchantAccount;
    private final boolean autoRescueAvailable;
    /**
     * Webhooks, refreshes and the user's actions change subscriptions from different threads: the changes of a
     * subscription run one at a time, under the lock its id maps to.
     */
    private final Object[] subscriptionLocks = Stream.generate(Object::new).limit(64).toArray();

    public SubscriptionService(@Qualifier("pspClient") Client pspClient,
                               @Value("${adyen.merchantAccount}") String merchantAccount,
                               @Value("${app.subscriptions.auto-rescue:false}") boolean autoRescueAvailable,
                               SubscriptionRepository subscriptionRepository,
                               InvoiceRepository invoiceRepository,
                               CustomerRepository customerRepository,
                               UserRepository userRepository,
                               InvoiceService invoiceService,
                               EntityManager entityManager) {
        this.recurringApi = new RecurringApi(pspClient);
        this.merchantAccount = merchantAccount;
        this.autoRescueAvailable = autoRescueAvailable;
        this.subscriptionRepository = subscriptionRepository;
        this.invoiceRepository = invoiceRepository;
        this.customerRepository = customerRepository;
        this.userRepository = userRepository;
        this.invoiceService = invoiceService;
        this.entityManager = entityManager;
    }

    // ---------- Read ----------

    public SubscriptionSettingsDTO settings(String userId) {
        User user = user(userId);
        List<BigDecimal> rates = VatRates.forCountry(user.getCountryCode());
        return new SubscriptionSettingsDTO(InvoiceService.currency(user), user.getCountryCode(),
                VatRates.taxLabel(user.getCountryCode()), rates, rates.get(0), autoRescueAvailable, DEFAULT_RESCUE_DAYS,
                MAX_RESCUE_DAYS, invoiceService.paymentLinksIssue(user));
    }

    /** Adyen enabled Auto Rescue on the merchant account. */
    boolean autoRescueAvailable() {
        return autoRescueAvailable;
    }

    /** The subscriptions of the user, the latest first. */
    public List<SubscriptionDTO> list(String userId) {
        user(userId);
        invoiceService.refresh(invoiceRepository.findByUserIdAndSubscriptionIdIsNotNull(userId), false);
        LocalDate today = InvoiceService.today();
        List<SubscriptionDTO> subscriptions = new ArrayList<>();
        for (Subscription found : subscriptionRepository.findByUserIdOrderByIdDesc(userId)) {
            synchronized (lockOf(found.getId())) {
                subscriptions.add(toDto(update(current(found), true), today, null));
            }
        }
        return subscriptions;
    }

    public SubscriptionDTO get(String userId, Long subscriptionId) {
        Subscription found = owned(userId, subscriptionId);
        invoiceService.refresh(invoices(subscriptionId), true);
        synchronized (lockOf(subscriptionId)) {
            return toDto(update(current(found), true), InvoiceService.today(), null);
        }
    }

    // ---------- Write ----------

    public SubscriptionDTO create(String userId, SubscriptionRequest request) {
        return create(userId, request, null);
    }

    /**
     * Creates the subscription with the invoice of its first cycle, and sends that invoice with a payment link that
     * stores the payment method. When the link can't be created, the invoice stays a draft to send again.
     *
     * @param demoKey marks a subscription of the demo data, null otherwise
     */
    SubscriptionDTO create(String userId, SubscriptionRequest request, String demoKey) {
        User user = user(userId);
        String issue = invoiceService.paymentLinksIssue(user);
        if (issue != null) {
            throw new BadRequestException(issue);
        }
        Subscription subscription = newSubscription(user, request);
        subscription.setDemoKey(demoKey);
        Instant now = Instant.now();
        addEvent(subscription, SubscriptionEvent.Type.CREATED, now, subscription.getPlan() + ": "
                + money(total(subscription), subscription.getCurrency()) + " " + per(subscription.getFrequency())
                + " including tax, from " + day(subscription.getStartDate()) + "."
                + (subscription.isAutoRescue()
                ? " Auto Rescue retries the refused card charges for up to " + subscription.getRescueDays() + " days."
                : ""), null, null);
        subscription = subscriptionRepository.save(subscription);
        synchronized (lockOf(subscription.getId())) {
            Invoice invoice;
            try {
                invoice = billCycle(subscription, 1, now);
            } catch (RuntimeException e) {
                subscriptionRepository.delete(subscription);
                throw e;
            }
            subscription = subscriptionRepository.save(subscription);
            String warning = null;
            try {
                InvoiceDTO sent = invoiceService.send(userId, invoice.getId());
                addEvent(subscription, SubscriptionEvent.Type.INVOICE_SENT, Instant.now(), sent.number() + " sent to "
                        + sent.customer().email() + " with a payment link.", sent.number(), null);
                subscription = subscriptionRepository.save(subscription);
            } catch (ApiException e) {
                String reason = BillService.adyenError(e);
                log.warn("Payment link of subscription invoice {} refused: {}", invoice.getNumber(), reason);
                warning = "The subscription is created, but the payment link of " + invoice.getNumber() + " was refused"
                        + (reason != null ? " (" + reason + ")" : "") + ". Send it again from the subscription.";
            } catch (IOException | RuntimeException e) {
                log.warn("Payment link of subscription invoice {} not created: {}", invoice.getNumber(), e.getMessage());
                warning = "The subscription is created, but the payment link of " + invoice.getNumber()
                        + " couldn't be created. Send it again from the subscription.";
            }
            return toDto(new State(subscription, invoices(subscription.getId())), InvoiceService.today(), warning);
        }
    }

    /**
     * Bills the next cycle now, and charges its invoice to the stored payment method. When the charge of the last
     * cycle was refused, charges that invoice again instead.
     */
    public SubscriptionDTO runCycle(String userId, Long subscriptionId, SubscriptionChargeRequest request)
            throws ApiException {
        Subscription found = owned(userId, subscriptionId);
        synchronized (lockOf(subscriptionId)) {
            State state = update(current(found), true);
            Subscription subscription = state.subscription();
            String blocked = runCycleBlocked(subscription, state.invoices());
            if (blocked != null) {
                throw new ConflictException(blocked);
            }
            TestOutcome outcome = testOutcome(request, subscription);
            Invoice invoice = openInvoice(state.invoices());
            if (invoice == null) {
                invoice = billCycle(subscription, subscription.getCyclesBilled() + 1, Instant.now());
                subscription = subscriptionRepository.save(subscription);
            }
            InvoiceService.ChargeResult result;
            try {
                result = invoiceService.charge(invoice.getId(), charge(subscription, outcome));
            } catch (ApiException e) {
                String reason = BillService.adyenError(e);
                addEvent(subscription, SubscriptionEvent.Type.CHARGE_FAILED, Instant.now(), "The charge of "
                        + invoice.getNumber() + " was rejected" + (reason != null ? ": " + reason : "") + ".", invoice.getNumber(), null);
                subscriptionRepository.save(subscription);
                throw e;
            } catch (IOException e) {
                log.warn("No answer from Adyen to the charge of invoice {}: {}", invoice.getNumber(), e.getMessage());
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "No answer to the charge. Run the cycle again: the invoice can't be charged twice.");
            }
            applyCharge(subscription, result);
            subscription = subscriptionRepository.save(subscription);
            return toDto(new State(subscription, invoices(subscriptionId)), InvoiceService.today(), null);
        }
    }

    /** Stops Auto Rescue from retrying the refused charge of the subscription's invoice. */
    public SubscriptionDTO stopRescue(String userId, Long subscriptionId) throws IOException, ApiException {
        Subscription found = owned(userId, subscriptionId);
        synchronized (lockOf(subscriptionId)) {
            State state = update(current(found), false);
            Invoice rescuing = state.invoices().stream()
                    .filter(SubscriptionService::rescuing)
                    .findFirst()
                    .orElseThrow(() -> new ConflictException("Auto Rescue isn't retrying any charge of this subscription."));
            String rescueReference = rescuing.getRescueReference();
            invoiceService.stopRescue(rescuing.getId());
            Subscription subscription = state.subscription();
            addEvent(subscription, SubscriptionEvent.Type.RESCUE_STOPPED, Instant.now(), "Auto Rescue of "
                    + rescuing.getNumber() + " stopped: its charge won't be retried.", rescuing.getNumber(), rescueReference);
            subscription = subscriptionRepository.save(subscription);
            return toDto(new State(subscription, invoices(subscriptionId)), InvoiceService.today(), null);
        }
    }

    /**
     * Cancels the subscription: no more cycles are billed, and its unpaid invoices are voided. An invoice whose charge
     * Adyen hasn't confirmed yet stays open: it's paid if the charge goes through.
     */
    public SubscriptionDTO cancel(String userId, Long subscriptionId) throws IOException, ApiException {
        Subscription found = owned(userId, subscriptionId);
        synchronized (lockOf(subscriptionId)) {
            State state = update(current(found), false);
            Subscription subscription = state.subscription();
            if (subscription.getStatus() == Subscription.Status.CANCELLED) {
                return toDto(state, InvoiceService.today(), null);
            }
            List<String> voided = new ArrayList<>();
            List<String> pending = new ArrayList<>();
            for (Invoice invoice : state.invoices()) {
                if (invoice.getStatus() != Invoice.Status.DRAFT && invoice.getStatus() != Invoice.Status.SENT) {
                    continue;
                }
                if (invoice.getStatus() == Invoice.Status.SENT && invoice.getChargeStatus() == Invoice.ChargeStatus.PENDING) {
                    pending.add(invoice.getNumber());
                    continue;
                }
                if (rescuing(invoice)) {
                    invoiceService.stopRescue(invoice.getId());
                }
                invoiceService.voidForSubscription(invoice.getId());
                voided.add(invoice.getNumber());
            }
            Instant now = Instant.now();
            subscription.setStatus(Subscription.Status.CANCELLED);
            subscription.setCancelledAt(now);
            subscription.setPastDueSince(null);
            StringBuilder detail = new StringBuilder("Cancelled: no more cycles are billed.");
            if (!voided.isEmpty()) {
                detail.append(" Voided ").append(String.join(", ", voided)).append('.');
            }
            if (!pending.isEmpty()) {
                detail.append(' ').append(String.join(", ", pending))
                        .append(pending.size() == 1 ? " stays open: its charge isn't confirmed yet."
                                : " stay open: their charges aren't confirmed yet.");
            }
            addEvent(subscription, SubscriptionEvent.Type.CANCELLED, now, detail.toString(), null, null);
            subscription = subscriptionRepository.save(subscription);
            return toDto(new State(subscription, invoices(subscriptionId)), InvoiceService.today(), null);
        }
    }

    /** Brings the subscription up to date after a webhook changed one of its invoices. Never throws. */
    public void sync(Long subscriptionId) {
        try {
            synchronized (lockOf(subscriptionId)) {
                subscriptionRepository.findById(subscriptionId).ifPresent(found -> update(current(found), true));
            }
        } catch (Exception e) {
            log.warn("Couldn't update subscription {} after a webhook: {}", subscriptionId, e.getMessage());
        }
    }

    // ---------- Billing cycles and charges ----------

    /** Creates the invoice of a billing cycle, and moves the subscription on to the next cycle. */
    private Invoice billCycle(Subscription subscription, int cycle, Instant now) {
        int months = subscription.getFrequency().months();
        LocalDate start = SubscriptionCycles.periodStart(subscription.getStartDate(), months, cycle);
        LocalDate end = SubscriptionCycles.periodEnd(subscription.getStartDate(), months, cycle);
        String period = SubscriptionCycles.periodLabel(start, end);
        LocalDate today = InvoiceService.today();
        boolean first = cycle == 1;
        InvoiceRequest request = new InvoiceRequest(subscription.getCustomer().getId(), today,
                first ? today.plusDays(FIRST_INVOICE_TERMS_DAYS) : today,
                first
                        ? "First invoice of your " + subscription.getPlan() + " subscription. Paying it saves your"
                        + " payment method: the next invoices are charged to it automatically."
                        : "Charged automatically to the payment method saved for your " + subscription.getPlan()
                        + " subscription.",
                List.of(new InvoiceRequest.Line(subscription.getPlan() + " — " + period, 1L, subscription.getPrice(),
                        subscription.getVatRate())));
        Invoice invoice = invoiceService.createCycleInvoice(subscription.getUserId(), request, subscription.getId(), cycle);
        subscription.setCyclesBilled(cycle);
        subscription.setNextBillingDate(SubscriptionCycles.periodStart(subscription.getStartDate(), months, cycle + 1));
        addEvent(subscription, SubscriptionEvent.Type.CYCLE_BILLED, now, "Cycle " + cycle + " (" + period
                + ") invoiced: " + money(invoice.getTotal(), invoice.getCurrency()) + ".", invoice.getNumber(), null);
        return invoice;
    }

    private InvoiceService.Charge charge(Subscription subscription, TestOutcome outcome) {
        // Auto Rescue of SEPA Direct Debit works on chargebacks, weeks later: the charges of the demo don't use it.
        boolean autoRescue = subscription.isAutoRescue() && autoRescueAvailable && !sepa(subscription);
        return new InvoiceService.Charge(subscription.getCustomer().getShopperReference(),
                subscription.getRecurringDetailReference(), subscription.getPaymentMethodVariant(),
                paymentMethodLabel(subscription), autoRescue,
                autoRescue ? Objects.requireNonNullElse(subscription.getRescueDays(), DEFAULT_RESCUE_DAYS) : null,
                outcome != null ? outcome.responseCode : null,
                outcome != null && autoRescue ? outcome.rescueScenario : null);
    }

    private TestOutcome testOutcome(SubscriptionChargeRequest request, Subscription subscription) {
        String value = request != null ? request.testOutcome() : null;
        if (value == null || value.isBlank()) {
            return null;
        }
        TestOutcome outcome;
        try {
            outcome = TestOutcome.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Choose one of the test outcomes.");
        }
        if (sepa(subscription)) {
            throw new BadRequestException("Test outcomes apply to cards only: a SEPA Direct Debit charge is confirmed later.");
        }
        if (outcome.rescueScenario != null && !(subscription.isAutoRescue() && autoRescueAvailable)) {
            throw new BadRequestException("This subscription doesn't use Auto Rescue, so its scenarios can't be tested.");
        }
        return outcome;
    }

    /** Logs how the charge of a cycle ended, and moves the subscription along with it. */
    private static void applyCharge(Subscription subscription, InvoiceService.ChargeResult result) {
        Invoice invoice = result.invoice();
        String number = invoice.getNumber();
        String method = paymentMethodLabel(subscription);
        Instant now = Instant.now();
        switch (result.status()) {
            case AUTHORISED -> {
                addEvent(subscription, SubscriptionEvent.Type.CHARGED, now, number + " charged to " + method + ": "
                        + money(invoice.getTotal(), invoice.getCurrency()) + ".", number, result.pspReference());
                reactivate(subscription, invoice, now);
            }
            case PENDING -> addEvent(subscription, SubscriptionEvent.Type.CHARGE_PENDING, now, number + " charged to "
                    + method + ": waiting for confirmation.", number, result.pspReference());
            case REFUSED, RESCUING -> {
                addEvent(subscription, SubscriptionEvent.Type.CHARGE_REFUSED, now, refusedDetail(subscription, invoice),
                        number, result.pspReference());
                pastDue(subscription, invoice, now);
            }
        }
    }

    /** Why the next cycle can't be billed now, null when it can. */
    private static String runCycleBlocked(Subscription subscription, List<Invoice> invoices) {
        switch (subscription.getStatus()) {
            case CANCELLED -> {
                return "This subscription is cancelled.";
            }
            case AWAITING_PAYMENT_METHOD -> {
                Invoice first = firstInvoice(invoices);
                if (first == null || first.getStatus() != Invoice.Status.PAID) {
                    return "The customer hasn't paid the first invoice yet: no payment method is stored to charge.";
                }
                Instant checkedAt = subscription.getPaymentMethodCheckedAt();
                return checkedAt != null && !checkedAt.isBefore(paidAt(first).plus(PAYMENT_METHOD_WAIT))
                        ? "No payment method was stored with the first payment. Cancel this subscription and start a new"
                        + " one, paid by card or SEPA Direct Debit."
                        : "The payment method of the first payment isn't available yet. Refresh in a moment.";
            }
            default -> {
            }
        }
        if (subscription.getRecurringDetailReference() == null) {
            return "No payment method is stored for this subscription.";
        }
        Invoice open = openInvoice(invoices);
        if (open != null && open.getStatus() == Invoice.Status.SENT
                && open.getChargeStatus() == Invoice.ChargeStatus.PENDING) {
            return "The charge of " + open.getNumber() + " isn't confirmed yet.";
        }
        if (open != null && rescuing(open)) {
            return "Auto Rescue is retrying the charge of " + open.getNumber() + ". Stop it to charge the invoice now.";
        }
        return null;
    }

    // ---------- State ----------

    /** Applies what happened to the invoices of the subscription. Under its lock. */
    private State update(Subscription subscription, boolean askAdyen) {
        List<Invoice> invoices = invoices(subscription.getId());
        Instant now = Instant.now();
        boolean changed = false;
        if (askAdyen && paymentMethodCheckDue(subscription, invoices, now)) {
            refreshPaymentMethod(subscription, now);
            changed = true;
        }
        changed |= applyInvoices(subscription, invoices, now);
        return new State(changed ? subscriptionRepository.save(subscription) : subscription, invoices);
    }

    /**
     * Whether to ask Adyen for the payment method the customer stored: an invoice was paid with its payment link since
     * the current one was stored, and Adyen wasn't asked yet once the payment had time to store it.
     */
    private static boolean paymentMethodCheckDue(Subscription subscription, List<Invoice> invoices, Instant now) {
        if (subscription.getStatus() == Subscription.Status.CANCELLED) {
            return false;
        }
        Instant checkedAt = subscription.getPaymentMethodCheckedAt();
        if (checkedAt != null && checkedAt.plus(PAYMENT_METHOD_CHECK_INTERVAL).isAfter(now)) {
            return false;
        }
        Instant storedAt = subscription.getPaymentMethodStoredAt();
        return invoices.stream().anyMatch(invoice -> paidWithLink(invoice)
                && (storedAt == null || paidAt(invoice).isAfter(storedAt))
                && (checkedAt == null || checkedAt.isBefore(paidAt(invoice).plus(PAYMENT_METHOD_WAIT))));
    }

    /** Asks Adyen for the payment methods the customer stored: the next cycles are charged to the latest one. */
    private void refreshPaymentMethod(Subscription subscription, Instant now) {
        subscription.setPaymentMethodCheckedAt(now);
        RecurringDetail latest;
        try {
            RecurringDetailsResult result = recurringApi.listRecurringDetails(new RecurringDetailsRequest()
                    .merchantAccount(merchantAccount)
                    .shopperReference(subscription.getCustomer().getShopperReference())
                    .recurring(new Recurring().contract(Recurring.ContractEnum.RECURRING)));
            latest = result.getDetails() == null ? null : result.getDetails().stream()
                    .map(RecurringDetailWrapper::getRecurringDetail)
                    .filter(detail -> detail != null && detail.getRecurringDetailReference() != null)
                    .max(Comparator.comparing(RecurringDetail::getCreationDate,
                            Comparator.nullsFirst(Comparator.<OffsetDateTime>naturalOrder())))
                    .orElse(null);
        } catch (Exception e) {
            log.warn("Couldn't get the payment methods stored for subscription {}: {}", subscription.getId(),
                    e.getMessage());
            return;
        }
        if (latest == null || latest.getRecurringDetailReference().equals(subscription.getRecurringDetailReference())) {
            return;
        }
        boolean replaced = subscription.getRecurringDetailReference() != null;
        subscription.setRecurringDetailReference(latest.getRecurringDetailReference());
        subscription.setPaymentMethodVariant(latest.getVariant());
        if (latest.getCard() != null) {
            subscription.setPaymentMethodLastDigits(lastDigits(latest.getCard().getNumber()));
            subscription.setPaymentMethodExpiry(expiry(latest.getCard().getExpiryMonth(), latest.getCard().getExpiryYear()));
            subscription.setPaymentMethodHolder(latest.getCard().getHolderName());
        } else if (latest.getBank() != null) {
            subscription.setPaymentMethodLastDigits(lastDigits(latest.getBank().getIban()));
            subscription.setPaymentMethodExpiry(null);
            subscription.setPaymentMethodHolder(latest.getBank().getOwnerName());
        } else {
            subscription.setPaymentMethodLastDigits(null);
            subscription.setPaymentMethodExpiry(null);
            subscription.setPaymentMethodHolder(null);
        }
        subscription.setPaymentMethodStoredAt(now);
        addEvent(subscription, SubscriptionEvent.Type.PAYMENT_METHOD_STORED, now, paymentMethodLabel(subscription)
                + (replaced ? " replaces the previous payment method" : " stored")
                + ": the next cycles are charged to it.", null, null);
    }

    /** Moves the subscription along with its invoices. Returns true when it changed. */
    private static boolean applyInvoices(Subscription subscription, List<Invoice> invoices, Instant now) {
        boolean changed = false;
        for (Invoice invoice : invoices) {
            if (invoice.getStatus() == Invoice.Status.PAID && !logged(subscription, invoice.getNumber(), null,
                    SubscriptionEvent.Type.PAID, SubscriptionEvent.Type.CHARGED)) {
                boolean charged = invoice.getChargeStatus() == Invoice.ChargeStatus.AUTHORISED;
                addEvent(subscription, charged ? SubscriptionEvent.Type.CHARGED : SubscriptionEvent.Type.PAID,
                        Objects.requireNonNullElse(invoice.getPaidAt(), now), paidDetail(invoice), invoice.getNumber(),
                        invoice.getPspReference());
                changed = true;
            }
        }
        switch (subscription.getStatus()) {
            case CANCELLED -> {
                return changed;
            }
            case AWAITING_PAYMENT_METHOD -> {
                Invoice first = firstInvoice(invoices);
                if (first != null && first.getStatus() == Invoice.Status.PAID
                        && subscription.getRecurringDetailReference() != null) {
                    subscription.setStatus(Subscription.Status.ACTIVE);
                    subscription.setActivatedAt(now);
                    addEvent(subscription, SubscriptionEvent.Type.ACTIVATED, now, "Active: the next cycles are charged to "
                            + paymentMethodLabel(subscription) + ", from " + day(subscription.getNextBillingDate()) + ".",
                            null, null);
                    changed = true;
                }
                return changed;
            }
            default -> {
            }
        }
        Invoice latest = latestCycle(invoices);
        if (latest == null) {
            return changed;
        }
        if (latest.getStatus() == Invoice.Status.PAID) {
            changed |= reactivate(subscription, latest, now);
        } else if (latest.getStatus() == Invoice.Status.SENT && (latest.getChargeStatus() == Invoice.ChargeStatus.REFUSED
                || latest.getChargeStatus() == Invoice.ChargeStatus.RESCUING)) {
            String number = latest.getNumber();
            String pspReference = latest.getChargePspReference();
            // A charge Adyen accepted first, then refused in a webhook.
            if (pspReference != null && !logged(subscription, number, pspReference, SubscriptionEvent.Type.CHARGE_REFUSED)) {
                addEvent(subscription, SubscriptionEvent.Type.CHARGE_REFUSED, now, refusedDetail(subscription, latest),
                        number, pspReference);
                changed = true;
            }
            // The invoice keeps the reference of a rescue that ended until it's charged again.
            String rescueReference = latest.getRescueReference();
            if (latest.getChargeStatus() == Invoice.ChargeStatus.REFUSED && rescueReference != null
                    && !logged(subscription, number, rescueReference, SubscriptionEvent.Type.RESCUE_ENDED,
                    SubscriptionEvent.Type.RESCUE_STOPPED)) {
                addEvent(subscription, SubscriptionEvent.Type.RESCUE_ENDED, now, number + ": " + lastRefusal(latest),
                        number, rescueReference);
                changed = true;
            }
            changed |= pastDue(subscription, latest, now);
        }
        return changed;
    }

    /** A past due subscription is active again once the invoice that made it past due is paid. */
    private static boolean reactivate(Subscription subscription, Invoice paid, Instant now) {
        if (subscription.getStatus() != Subscription.Status.PAST_DUE) {
            return false;
        }
        subscription.setStatus(Subscription.Status.ACTIVE);
        subscription.setPastDueSince(null);
        addEvent(subscription, SubscriptionEvent.Type.REACTIVATED, now, paid.getNumber()
                + " is paid: the subscription is active again.", paid.getNumber(), null);
        return true;
    }

    private static boolean pastDue(Subscription subscription, Invoice unpaid, Instant now) {
        if (subscription.getStatus() != Subscription.Status.ACTIVE) {
            return false;
        }
        subscription.setStatus(Subscription.Status.PAST_DUE);
        subscription.setPastDueSince(now);
        addEvent(subscription, SubscriptionEvent.Type.PAST_DUE, now, unpaid.getNumber()
                + " is unpaid: its charge was refused.", unpaid.getNumber(), null);
        return true;
    }

    private static String paidDetail(Invoice invoice) {
        String number = invoice.getNumber();
        if (invoice.getChargeStatus() != Invoice.ChargeStatus.AUTHORISED) {
            String name = PaymentMethodNames.of(invoice.getPaymentMethod());
            return number + " paid with its payment link" + (name != null ? " by " + name : "") + ".";
        }
        return invoice.getRescueReference() != null
                ? number + " paid: Auto Rescue recovered its charge."
                : number + " paid: its charge is confirmed.";
    }

    private static String refusedDetail(Subscription subscription, Invoice invoice) {
        String reason = invoice.getChargeRefusalReason();
        String rescue = invoice.getChargeStatus() != Invoice.ChargeStatus.RESCUING ? ""
                : subscription.getRescueDays() != null
                ? " Auto Rescue retries it for up to " + subscription.getRescueDays() + " days."
                : " Auto Rescue retries it.";
        return "The charge of " + invoice.getNumber() + " to " + paymentMethodLabel(subscription) + " was refused"
                + (reason != null ? ": " + reason : "") + "." + rescue;
    }

    /** What the last refusal of the invoice says, e.g. how its Auto Rescue ended. */
    private static String lastRefusal(Invoice invoice) {
        return invoice.getEvents().stream()
                .filter(event -> event.getType() == InvoiceEvent.Type.PAYMENT_REFUSED)
                .reduce((first, second) -> second)
                .map(InvoiceEvent::getDetail)
                .orElse("Auto Rescue ended without recovering the payment.");
    }

    // ---------- Validation and mapping ----------

    private Subscription newSubscription(User user, SubscriptionRequest request) {
        if (request == null) {
            throw new BadRequestException("The subscription is missing.");
        }
        Customer customer = request.customerId() == null ? null
                : customerRepository.findByIdAndUserId(request.customerId(), user.getId()).orElse(null);
        if (customer == null) {
            throw new BadRequestException("Choose a customer.");
        }
        String plan = request.plan() != null ? request.plan().trim().replaceAll("\\s+", " ") : "";
        if (plan.isEmpty()) {
            throw new BadRequestException("Enter the name of the plan.");
        }
        if (plan.length() > MAX_PLAN) {
            throw new BadRequestException("The plan name can have up to " + MAX_PLAN + " characters.");
        }
        Long price = request.price();
        if (price == null || price <= 0 || price > MAX_PRICE) {
            throw new BadRequestException("Enter a price greater than 0.");
        }
        BigDecimal vatRate = request.vatRate() != null ? request.vatRate() : BigDecimal.ZERO;
        if (vatRate.signum() < 0 || vatRate.compareTo(HUNDRED) > 0) {
            throw new BadRequestException("The tax rate must be between 0 and 100%.");
        }
        if (vatRate.stripTrailingZeros().scale() > 2) {
            throw new BadRequestException("The tax rate can have up to 2 decimals.");
        }
        try {
            InvoiceMath.line(1, price, vatRate);
        } catch (ArithmeticException e) {
            throw new BadRequestException("The price is too large.");
        }
        Subscription.Frequency frequency;
        try {
            frequency = Subscription.Frequency.valueOf(
                    Objects.requireNonNullElse(request.frequency(), "MONTHLY").trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Choose a monthly or a yearly billing.");
        }
        LocalDate today = InvoiceService.today();
        LocalDate startDate = request.startDate() != null ? request.startDate() : today;
        if (Math.abs(ChronoUnit.DAYS.between(today, startDate)) > MAX_START_DAYS) {
            throw new BadRequestException("The start date must be within a year of today.");
        }
        boolean autoRescue = Boolean.TRUE.equals(request.autoRescue());
        if (autoRescue && !autoRescueAvailable) {
            throw new BadRequestException("Auto Rescue isn't enabled on the merchant account.");
        }
        Integer rescueDays = null;
        if (autoRescue) {
            rescueDays = request.rescueDays() != null ? request.rescueDays() : DEFAULT_RESCUE_DAYS;
            if (rescueDays < 1 || rescueDays > MAX_RESCUE_DAYS) {
                throw new BadRequestException("Auto Rescue retries a charge for 1 to " + MAX_RESCUE_DAYS + " days.");
            }
        }
        Subscription subscription = new Subscription();
        subscription.setUserId(user.getId());
        subscription.setCustomer(customer);
        subscription.setPlan(plan);
        subscription.setPrice(price);
        subscription.setVatRate(vatRate.setScale(2));
        subscription.setCurrency(InvoiceService.currency(user));
        subscription.setFrequency(frequency);
        subscription.setStatus(Subscription.Status.AWAITING_PAYMENT_METHOD);
        subscription.setStartDate(startDate);
        subscription.setNextBillingDate(startDate);
        subscription.setCyclesBilled(0);
        subscription.setAutoRescue(autoRescue);
        subscription.setRescueDays(rescueDays);
        return subscription;
    }

    private SubscriptionDTO toDto(State state, LocalDate today, String warning) {
        Subscription subscription = state.subscription();
        List<Invoice> invoices = state.invoices();
        Customer customer = subscription.getCustomer();
        int months = subscription.getFrequency().months();
        boolean cancelled = subscription.getStatus() == Subscription.Status.CANCELLED;
        Instant now = Instant.now();
        List<SubscriptionDTO.InvoiceRef> invoiceRefs = invoices.stream()
                .sorted(Comparator.comparingInt(SubscriptionService::cycleOf).reversed())
                .map(invoice -> {
                    int cycle = Math.max(cycleOf(invoice), 1);
                    Invoice.Status status = invoice.getStatus();
                    boolean overdue = status == Invoice.Status.SENT && invoice.getDueDate().isBefore(today);
                    boolean settling = status == Invoice.Status.SENT
                            && (invoice.getChargeStatus() == Invoice.ChargeStatus.PENDING || rescuing(invoice));
                    boolean linkOpen = status == Invoice.Status.SENT && !InvoiceService.linkExpired(invoice, now);
                    return new SubscriptionDTO.InvoiceRef(invoice.getId(), invoice.getNumber(), cycle,
                            SubscriptionCycles.periodStart(subscription.getStartDate(), months, cycle),
                            SubscriptionCycles.periodEnd(subscription.getStartDate(), months, cycle),
                            overdue ? "OVERDUE" : status.name(), invoice.getTotal(), invoice.getDueDate(),
                            invoice.getChargeStatus() != null ? invoice.getChargeStatus().name() : null,
                            invoice.getChargeRefusalReason(), invoice.getPaidAt(),
                            linkOpen ? PaymentLinks.pageUrl(invoice.getPaymentLinkUrl()) : null,
                            !cancelled && !settling
                                    && (status == Invoice.Status.DRAFT || (status == Invoice.Status.SENT && !linkOpen)));
                })
                .toList();
        List<SubscriptionDTO.Event> events = subscription.getEvents().stream()
                .sorted(Comparator.comparing(SubscriptionEvent::getOccurredAt))
                .map(event -> new SubscriptionDTO.Event(event.getType().name(), event.getOccurredAt(), event.getDetail(),
                        event.getInvoiceNumber()))
                .toList();
        String runCycleBlocked = runCycleBlocked(subscription, invoices);
        Invoice open = openInvoice(invoices);
        return new SubscriptionDTO(
                subscription.getId(),
                subscription.getStatus().name(),
                new SubscriptionDTO.CustomerRef(customer.getId(), customer.displayName(), customer.getEmail()),
                subscription.getPlan(),
                subscription.getFrequency().name(),
                subscription.getPrice(),
                subscription.getVatRate(),
                total(subscription),
                subscription.getCurrency(),
                subscription.getStartDate(),
                subscription.getNextBillingDate(),
                subscription.getCyclesBilled(),
                paymentMethod(subscription),
                subscription.isAutoRescue() && autoRescueAvailable,
                subscription.getRescueDays(),
                subscription.getCreatedAt(),
                subscription.getActivatedAt(),
                subscription.getPastDueSince(),
                subscription.getCancelledAt(),
                invoiceRefs,
                events,
                runCycleBlocked,
                runCycleBlocked == null && open != null ? open.getNumber() : null,
                !cancelled && invoices.stream().anyMatch(SubscriptionService::rescuing),
                !cancelled,
                subscription.getRecurringDetailReference() != null && !sepa(subscription),
                warning);
    }

    private static SubscriptionDTO.PaymentMethod paymentMethod(Subscription subscription) {
        if (subscription.getRecurringDetailReference() == null) {
            return null;
        }
        return new SubscriptionDTO.PaymentMethod(subscription.getPaymentMethodVariant(),
                methodName(subscription.getPaymentMethodVariant()), paymentMethodLabel(subscription),
                subscription.getPaymentMethodLastDigits(), subscription.getPaymentMethodExpiry(),
                subscription.getPaymentMethodHolder(), subscription.getPaymentMethodStoredAt(), !sepa(subscription));
    }

    /** E.g. "Mastercard •••• 1111". */
    private static String paymentMethodLabel(Subscription subscription) {
        String name = methodName(subscription.getPaymentMethodVariant());
        String digits = subscription.getPaymentMethodLastDigits();
        return digits != null ? name + " •••• " + digits : name;
    }

    private static String methodName(String variant) {
        String name = PaymentMethodNames.of(variant);
        return name != null ? name : "Stored payment method";
    }

    private static boolean sepa(Subscription subscription) {
        return SEPA_DIRECT_DEBIT.equals(subscription.getPaymentMethodVariant());
    }

    /** The price of a cycle, including VAT. */
    private static long total(Subscription subscription) {
        return InvoiceMath.line(1, subscription.getPrice(), subscription.getVatRate()).gross();
    }

    private static Invoice firstInvoice(List<Invoice> invoices) {
        return invoices.stream().filter(invoice -> cycleOf(invoice) == 1).findFirst().orElse(null);
    }

    /** The invoice of the latest cycle after the first, unless it's void. */
    private static Invoice latestCycle(List<Invoice> invoices) {
        return invoices.stream()
                .filter(invoice -> cycleOf(invoice) > 1 && invoice.getStatus() != Invoice.Status.VOID)
                .max(Comparator.comparingInt(SubscriptionService::cycleOf))
                .orElse(null);
    }

    /** The unpaid invoice of a cycle after the first: running the cycle charges it again. */
    private static Invoice openInvoice(List<Invoice> invoices) {
        return invoices.stream()
                .filter(invoice -> cycleOf(invoice) > 1)
                .filter(invoice -> invoice.getStatus() == Invoice.Status.DRAFT || invoice.getStatus() == Invoice.Status.SENT)
                .max(Comparator.comparingInt(SubscriptionService::cycleOf))
                .orElse(null);
    }

    private static boolean rescuing(Invoice invoice) {
        return invoice.getStatus() == Invoice.Status.SENT && invoice.getChargeStatus() == Invoice.ChargeStatus.RESCUING;
    }

    /** Paid by the customer with the payment link of the invoice, rather than charged. */
    private static boolean paidWithLink(Invoice invoice) {
        return invoice.getStatus() == Invoice.Status.PAID && invoice.getPaymentLinkId() != null
                && invoice.getChargeStatus() != Invoice.ChargeStatus.AUTHORISED;
    }

    private static Instant paidAt(Invoice invoice) {
        return Objects.requireNonNullElse(invoice.getPaidAt(), Instant.EPOCH);
    }

    private static int cycleOf(Invoice invoice) {
        return invoice.getSubscriptionCycle() != null ? invoice.getSubscriptionCycle() : 0;
    }

    /**
     * Whether the timeline already has an event of these types about the invoice, and about this payment when one is
     * given.
     */
    private static boolean logged(Subscription subscription, String invoiceNumber, String pspReference,
                                  SubscriptionEvent.Type... types) {
        List<SubscriptionEvent.Type> wanted = List.of(types);
        return subscription.getEvents().stream().anyMatch(event -> wanted.contains(event.getType())
                && Objects.equals(event.getInvoiceNumber(), invoiceNumber)
                && (pspReference == null || pspReference.equals(event.getPspReference())));
    }

    private static void addEvent(Subscription subscription, SubscriptionEvent.Type type, Instant occurredAt,
                                 String detail, String invoiceNumber, String pspReference) {
        String text = detail != null && detail.length() > MAX_EVENT_DETAIL ? detail.substring(0, MAX_EVENT_DETAIL) : detail;
        subscription.addEvent(type, occurredAt, text, invoiceNumber, pspReference);
    }

    private static String lastDigits(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String digits = value.replace(" ", "");
        return digits.length() <= 4 ? digits : digits.substring(digits.length() - 4);
    }

    private static String expiry(String month, String year) {
        if (month == null || year == null) {
            return null;
        }
        return (month.length() == 1 ? "0" + month : month) + "/" + year;
    }

    private static String per(Subscription.Frequency frequency) {
        return frequency == Subscription.Frequency.YEARLY ? "a year" : "a month";
    }

    private static String money(long minorUnits, String currency) {
        return BillService.money(minorUnits, currency);
    }

    private static String day(LocalDate date) {
        return DAY.format(date);
    }

    private List<Invoice> invoices(Long subscriptionId) {
        return invoiceRepository.findBySubscriptionIdOrderBySubscriptionCycleAsc(subscriptionId);
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private Subscription owned(String userId, Long subscriptionId) {
        return subscriptionRepository.findByIdAndUserId(subscriptionId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Subscription not found"));
    }

    private Object lockOf(Long subscriptionId) {
        return subscriptionLocks[Math.floorMod(subscriptionId.hashCode(), subscriptionLocks.length)];
    }

    /**
     * The subscription as stored now, to change under its lock. The copy the request read before may be stale: Open
     * Session in View keeps it for the whole request, even after another thread changed the subscription.
     */
    private Subscription current(Subscription subscription) {
        entityManager.detach(subscription);
        return subscriptionRepository.findById(subscription.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Subscription not found"));
    }
}
