package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.RequestOptions;
import com.adyen.model.checkout.Amount;
import com.adyen.model.checkout.CardDetails;
import com.adyen.model.checkout.CheckoutPaymentMethod;
import com.adyen.model.checkout.LineItem;
import com.adyen.model.checkout.PaymentLinkRequest;
import com.adyen.model.checkout.PaymentLinkResponse;
import com.adyen.model.checkout.PaymentRequest;
import com.adyen.model.checkout.PaymentResponse;
import com.adyen.model.checkout.SepaDirectDebitDetails;
import com.adyen.model.checkout.UpdatePaymentLinkRequest;
import com.adyen.model.payment.CancelRequest;
import com.adyen.model.payment.ModificationResult;
import com.adyen.service.checkout.PaymentLinksApi;
import com.adyen.service.checkout.PaymentsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.payment.ModificationsApi;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.InvoiceRequest;
import com.myplatform.demo.dto.InvoiceSettingsDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Customer;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.InvoiceEvent;
import com.myplatform.demo.model.InvoiceLine;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.model.User;
import com.myplatform.demo.model.WebhookEvent;
import com.myplatform.demo.repository.CustomerRepository;
import com.myplatform.demo.repository.InvoiceRepository;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import com.myplatform.demo.util.AdyenNotifications;
import com.myplatform.demo.util.InvoiceMath;
import com.myplatform.demo.util.PaymentLinks;
import com.myplatform.demo.util.PaymentMethodNames;
import com.myplatform.demo.util.PaymentResultRedirects;
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
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

/**
 * Customer invoices: numbering, VAT, the Adyen payment link the customer pays them with, and their status.
 * An invoice is paid when the AUTHORISATION webhook of its link arrives. Without webhooks, opening the
 * invoices reads the webhooks other backends stored, then asks Adyen for the status of the link.
 * The invoices of a subscription are also charged to the payment method its first invoice stored.
 */
@Service
public class InvoiceService {

    private static final Logger log = LoggerFactory.getLogger(InvoiceService.class);

    public static final int PAYMENT_TERMS_DAYS = 30;
    /** Adyen refuses a payment link that expires more than 70 days after it's created. */
    private static final Duration MAX_LINK_VALIDITY = Duration.ofDays(70).minusHours(1);
    /** The link of an invoice that is due soon, or already overdue, still gives the customer a week to pay. */
    private static final Duration MIN_LINK_VALIDITY = Duration.ofDays(7);
    /** How often an open payment link is checked at Adyen, when no webhook settled it. */
    private static final Duration LIST_CHECK_INTERVAL = Duration.ofSeconds(60);
    private static final Duration DETAIL_CHECK_INTERVAL = Duration.ofSeconds(15);
    /** Keeps the list fast: the other links are checked when it's opened again. */
    private static final int MAX_CHECKS_PER_LIST = 5;
    /** How often a charge Adyen hasn't settled is looked up in the webhooks other backends stored. */
    private static final Duration CHARGE_CHECK_INTERVAL = Duration.ofSeconds(30);
    private static final int MAX_LINES = 50;
    private static final long MAX_QUANTITY = 1_000_000;
    private static final long MAX_UNIT_PRICE = 100_000_000_000L;
    private static final int MAX_DESCRIPTION = 200;
    private static final int MAX_NOTES = 1000;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final String AUTHORISATION = "AUTHORISATION";
    private static final String AUTORESCUE = "AUTORESCUE";
    private static final String CANCEL_AUTORESCUE = "CANCEL_AUTORESCUE";
    private static final String SEPA_DIRECT_DEBIT = "sepadirectdebit";
    private static final String LINK_EXPIRED = PaymentLinkResponse.StatusEnum.EXPIRED.getValue();
    private static final String REFERENCE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final InvoiceRepository invoiceRepository;
    private final CustomerRepository customerRepository;
    private final UserRepository userRepository;
    private final StoreCustomerRepository storeCustomerRepository;
    private final WebhookEventRepository webhookEventRepository;
    private final CheckoutPaymentService checkoutPaymentService;
    private final LegalEntityService legalEntityService;
    private final AccountStatementService accountStatementService;
    private final InvoicePdfService pdfService;
    private final ObjectMapper objectMapper;
    private final EntityManager entityManager;
    private final PaymentLinksApi paymentLinksApi;
    private final PaymentsApi paymentsApi;
    private final ModificationsApi modificationsApi;
    private final String merchantAccount;
    /**
     * Webhooks, checks of payment links and the user's actions change invoices from different threads: the changes
     * of an invoice run one at a time, under the lock its id maps to.
     */
    private final Object[] invoiceLocks = Stream.generate(Object::new).limit(64).toArray();
    /** When each unsettled charge was last looked up in the stored webhooks. */
    private final Map<Long, Instant> chargeCheckedAt = new ConcurrentHashMap<>();

    /** An invoice as a PDF, and the name to save it under. */
    public record InvoicePdf(byte[] content, String fileName) {
    }

    /**
     * A charge to the payment method a subscription stored.
     *
     * @param methodLabel  the stored payment method for people, e.g. "Mastercard •••• 1111"
     * @param rescueDays   how long Auto Rescue retries a refused charge, when it's on
     * @param testRefusal  TEST only: the acquirer response code to simulate, null to charge normally
     * @param testScenario TEST only: the Auto Rescue scenario to simulate, null to charge normally
     */
    record Charge(String shopperReference, String storedPaymentMethodId, String paymentMethodVariant, String methodLabel,
                  boolean autoRescue, Integer rescueDays, String testRefusal, String testScenario) {
    }

    /** The invoice once charged, and how Adyen answered. */
    record ChargeResult(Invoice invoice, Invoice.ChargeStatus status, String pspReference, String refusalReason) {
    }

    public InvoiceService(@Qualifier("pspClient") Client pspClient,
                          @Value("${adyen.merchantAccount}") String merchantAccount,
                          InvoiceRepository invoiceRepository,
                          CustomerRepository customerRepository,
                          UserRepository userRepository,
                          StoreCustomerRepository storeCustomerRepository,
                          WebhookEventRepository webhookEventRepository,
                          CheckoutPaymentService checkoutPaymentService,
                          LegalEntityService legalEntityService,
                          AccountStatementService accountStatementService,
                          InvoicePdfService pdfService,
                          ObjectMapper objectMapper,
                          EntityManager entityManager) {
        this.paymentLinksApi = new PaymentLinksApi(pspClient);
        this.paymentsApi = new PaymentsApi(pspClient);
        this.modificationsApi = new ModificationsApi(pspClient);
        this.merchantAccount = merchantAccount;
        this.invoiceRepository = invoiceRepository;
        this.customerRepository = customerRepository;
        this.userRepository = userRepository;
        this.storeCustomerRepository = storeCustomerRepository;
        this.webhookEventRepository = webhookEventRepository;
        this.checkoutPaymentService = checkoutPaymentService;
        this.legalEntityService = legalEntityService;
        this.accountStatementService = accountStatementService;
        this.pdfService = pdfService;
        this.objectMapper = objectMapper;
        this.entityManager = entityManager;
    }

    // ---------- Read ----------

    public InvoiceSettingsDTO settings(String userId) {
        User user = user(userId);
        List<BigDecimal> rates = VatRates.forCountry(user.getCountryCode());
        int year = today().getYear();
        String issue = paymentLinksIssue(user);
        return new InvoiceSettingsDTO(currency(user), user.getCountryCode(), VatRates.taxLabel(user.getCountryCode()),
                rates, rates.get(0),
                PAYMENT_TERMS_DAYS, formatNumber(year, nextSequenceNumber(userId, year)), issue == null, issue);
    }

    /** The invoices of the user, the latest number first. */
    public List<InvoiceDTO> list(String userId) {
        user(userId);
        List<Invoice> invoices = invoiceRepository.findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId);
        if (refresh(invoices, false)) {
            invoices = invoiceRepository.findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId);
        }
        LocalDate today = today();
        return invoices.stream().map(invoice -> toDto(invoice, today)).toList();
    }

    public InvoiceDTO get(String userId, Long invoiceId) {
        Invoice invoice = owned(userId, invoiceId);
        if (refresh(List.of(invoice), true)) {
            invoice = owned(userId, invoiceId);
        }
        return toDto(invoice, today());
    }

    /**
     * Settles what no webhook settled yet: the open payment links of these invoices, and their charges. Returns true
     * when an invoice changed.
     *
     * @param detail the invoices are shown in detail: their links are checked more often
     */
    boolean refresh(List<Invoice> invoices, boolean detail) {
        Instant now = Instant.now();
        boolean links = checkOpenLinks(invoices, detail ? DETAIL_CHECK_INTERVAL : LIST_CHECK_INTERVAL,
                MAX_CHECKS_PER_LIST, now);
        boolean charges = checkCharges(invoices, now);
        return links || charges;
    }

    public InvoicePdf pdf(String userId, Long invoiceId) {
        User user = user(userId);
        Invoice invoice = owned(userId, invoiceId);
        InvoiceDTO dto = toDto(invoice, today());
        try {
            byte[] content = pdfService.render(dto, seller(user), accountStatementService.platform(userId),
                    VatRates.taxLabel(user.getCountryCode()));
            return new InvoicePdf(content, invoice.getNumber() + ".pdf");
        } catch (RuntimeException e) {
            log.error("Couldn't create the PDF of invoice {}", invoice.getNumber(), e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Couldn't create the PDF of this invoice.");
        }
    }

    // ---------- Write ----------

    public InvoiceDTO create(String userId, InvoiceRequest request) {
        return create(userId, request, null);
    }

    /**
     * Synchronized with no surrounding transaction, so the next invoice reads the number this one saved.
     *
     * @param demoKey marks an invoice of the demo data, null otherwise
     */
    synchronized InvoiceDTO create(String userId, InvoiceRequest request, String demoKey) {
        return toDto(newInvoice(userId, request, demoKey, null, null), today());
    }

    /** The draft invoice of a billing cycle of a subscription. Synchronized like the other invoices, for its number. */
    synchronized Invoice createCycleInvoice(String userId, InvoiceRequest request, Long subscriptionId, int cycle) {
        return newInvoice(userId, request, null, subscriptionId, cycle);
    }

    private Invoice newInvoice(String userId, InvoiceRequest request, String demoKey, Long subscriptionId, Integer cycle) {
        User user = user(userId);
        Invoice invoice = new Invoice();
        invoice.setUserId(userId);
        invoice.setCurrency(currency(user));
        invoice.setStatus(Invoice.Status.DRAFT);
        invoice.setDemoKey(demoKey);
        apply(invoice, request, userId);
        int year = invoice.getIssueDate().getYear();
        int sequenceNumber = nextSequenceNumber(userId, year);
        invoice.setSequenceYear(year);
        invoice.setSequenceNumber(sequenceNumber);
        invoice.setNumber(formatNumber(year, sequenceNumber));
        if (subscriptionId != null) {
            invoice.setSubscriptionId(subscriptionId);
            invoice.setSubscriptionCycle(cycle);
            invoice.setChargeReference(invoice.getNumber() + "-" + randomSuffix());
        }
        invoice.addEvent(InvoiceEvent.Type.CREATED, Instant.now(), subscriptionId != null
                ? "Created for billing cycle " + cycle + " of a subscription."
                : "Draft created.", null);
        return invoiceRepository.save(invoice);
    }

    public InvoiceDTO update(String userId, Long invoiceId, InvoiceRequest request) {
        Invoice found = owned(userId, invoiceId);
        synchronized (lockOf(invoiceId)) {
            Invoice invoice = current(found);
            if (invoice.getStatus() != Invoice.Status.DRAFT) {
                throw new ConflictException("Only draft invoices can be edited.");
            }
            if (invoice.getSubscriptionId() != null) {
                throw new ConflictException("This invoice bills a subscription, so it can't be edited.");
            }
            apply(invoice, request, userId);
            return toDto(invoiceRepository.save(invoice), today());
        }
    }

    /**
     * Issues the invoice with an Adyen payment link, or creates a new link when the previous one expired.
     * Under the lock of the invoice, so a double click doesn't create two links.
     */
    public InvoiceDTO send(String userId, Long invoiceId) throws IOException, ApiException {
        User user = user(userId);
        Invoice invoice = owned(userId, invoiceId);
        synchronized (lockOf(invoiceId)) {
            return send(user, current(invoice));
        }
    }

    private InvoiceDTO send(User user, Invoice invoice) throws IOException, ApiException {
        Instant now = Instant.now();
        String charging = chargeInProgress(invoice);
        if (charging != null) {
            throw new ConflictException(charging);
        }
        switch (invoice.getStatus()) {
            case PAID -> throw new ConflictException("This invoice is already paid.");
            case VOID -> throw new ConflictException("A void invoice can't be sent.");
            case SENT -> {
                if (!linkExpired(invoice, now)) {
                    return toDto(invoice, today()); // the customer can still use its link
                }
            }
            case DRAFT -> {
            }
        }
        String issue = paymentLinksIssue(user);
        if (issue != null) {
            throw new BadRequestException(issue);
        }
        String storeReference = embedded(user) ? storeReference(user) : null;
        OffsetDateTime expiresAt = linkExpiry(invoice.getDueDate(), now);
        PaymentLinkResponse link = paymentLinksApi.paymentLinks(linkRequest(user, invoice, storeReference, expiresAt));

        boolean renewal = invoice.getPaymentLinkId() != null;
        invoice.setPaymentLinkId(link.getId());
        invoice.setPaymentLinkUrl(link.getUrl());
        invoice.setPaymentLinkExpiresAt((link.getExpiresAt() != null ? link.getExpiresAt() : expiresAt).toInstant());
        invoice.setPaymentLinkStatus(link.getStatus() != null
                ? link.getStatus().getValue()
                : PaymentLinkResponse.StatusEnum.ACTIVE.getValue());
        invoice.setPaymentLinkCheckedAt(now);
        invoice.setStoreReference(storeReference);
        invoice.setStatus(Invoice.Status.SENT);
        if (invoice.getSentAt() == null) {
            invoice.setSentAt(now);
        }
        String validity = "valid until " + day(invoice.getPaymentLinkExpiresAt()) + ".";
        invoice.addEvent(renewal ? InvoiceEvent.Type.LINK_RENEWED : InvoiceEvent.Type.SENT, now,
                renewal ? "New payment link created, " + validity : "Issued to " + invoice.getCustomer().getEmail()
                        + " with a payment link " + validity, null);
        return toDto(invoiceRepository.save(invoice), today());
    }

    /** Cancels an unpaid invoice and deactivates its payment link. */
    public InvoiceDTO voidInvoice(String userId, Long invoiceId) throws IOException, ApiException {
        Invoice found = owned(userId, invoiceId);
        synchronized (lockOf(invoiceId)) {
            Invoice invoice = current(found);
            if (invoice.getSubscriptionId() != null) {
                throw new ConflictException("This invoice bills a subscription: cancel the subscription instead.");
            }
            return toDto(voidInvoice(invoice), today());
        }
    }

    /** Voids an unpaid invoice of a subscription that is being cancelled. */
    Invoice voidForSubscription(Long invoiceId) throws IOException, ApiException {
        synchronized (lockOf(invoiceId)) {
            return voidInvoice(currentById(invoiceId));
        }
    }

    private Invoice voidInvoice(Invoice invoice) throws IOException, ApiException {
        Instant now = Instant.now();
        switch (invoice.getStatus()) {
            case PAID -> throw new ConflictException("A paid invoice can't be voided. Refund the payment instead.");
            case VOID -> {
                return invoice;
            }
            default -> {
            }
        }
        String charging = chargeInProgress(invoice);
        if (charging != null) {
            throw new ConflictException(charging);
        }
        closeLink(invoice, now, "voided");
        invoice.setStatus(Invoice.Status.VOID);
        invoice.setVoidedAt(now);
        invoice.addEvent(InvoiceEvent.Type.VOIDED, now, invoice.getPaymentLinkId() != null
                ? "Voided. The payment link no longer accepts payments."
                : "Voided.", null);
        return invoiceRepository.save(invoice);
    }

    /**
     * Stops the payment link of an unpaid invoice from taking payments. Throws when the customer has just paid with it,
     * or is paying.
     *
     * @param action what closing the link allows, for the error message: "voided", "charged"
     */
    private void closeLink(Invoice invoice, Instant now, String action) throws IOException, ApiException {
        if (invoice.getPaymentLinkId() == null || LINK_EXPIRED.equals(invoice.getPaymentLinkStatus())) {
            return;
        }
        PaymentLinkResponse link = paymentLinksApi.getPaymentLink(invoice.getPaymentLinkId());
        applyLinkStatus(invoice, link, now);
        invoice.setPaymentLinkCheckedAt(now);
        if (invoice.getStatus() == Invoice.Status.PAID) {
            invoiceRepository.save(invoice);
            throw new ConflictException("The customer has just paid this invoice, so it can't be " + action + ".");
        }
        if (link.getStatus() == PaymentLinkResponse.StatusEnum.PAYMENTPENDING) {
            invoiceRepository.save(invoice);
            throw new ConflictException("A payment of this invoice is in progress. Try again once it's settled.");
        }
        if (link.getStatus() == PaymentLinkResponse.StatusEnum.ACTIVE) {
            PaymentLinkResponse expired = paymentLinksApi.updatePaymentLink(invoice.getPaymentLinkId(),
                    new UpdatePaymentLinkRequest().status(UpdatePaymentLinkRequest.StatusEnum.EXPIRED));
            invoice.setPaymentLinkStatus(expired.getStatus() != null ? expired.getStatus().getValue() : LINK_EXPIRED);
        }
    }

    // ---------- Webhooks ----------

    /**
     * Applies a payment notification to the invoice it pays, and the end of an Auto Rescue to the invoice whose
     * charge it retried. Returns the invoice the notification is about, if any.
     */
    public Optional<Invoice> applyNotification(JsonNode item) {
        String eventCode = AdyenNotifications.text(item, "eventCode");
        boolean authorisation = AUTHORISATION.equals(eventCode);
        if (!authorisation && !AUTORESCUE.equals(eventCode) && !CANCEL_AUTORESCUE.equals(eventCode)) {
            return Optional.empty();
        }
        return findForNotification(item).map(found -> {
            synchronized (lockOf(found.getId())) {
                Invoice invoice = current(found);
                if (authorisation ? applyAuthorisation(invoice, item) : applyRescueOutcome(invoice, item, eventCode)) {
                    invoice = invoiceRepository.save(invoice);
                    log.info("Invoice {} updated from the {} webhook {}", invoice.getNumber(), eventCode,
                            AdyenNotifications.text(item, "pspReference"));
                }
                return invoice;
            }
        });
    }

    /**
     * The invoice a payment notification is about: the one of its payment link, else the only open invoice with its
     * reference, amount and currency (a payment made with a link that was replaced, or with a saved card).
     */
    public Optional<Invoice> findForPayment(JsonNode item) {
        String paymentLinkId = AdyenNotifications.additionalData(item, "paymentLinkId");
        if (paymentLinkId != null) {
            Optional<Invoice> invoice = invoiceRepository.findFirstByPaymentLinkId(paymentLinkId);
            if (invoice.isPresent()) {
                return invoice;
            }
        }
        Optional<Invoice> charged = findCharged(item);
        if (charged.isPresent()) {
            return charged;
        }
        String reference = AdyenNotifications.text(item, "merchantReference");
        Long value = AdyenNotifications.amountValue(item);
        String currency = AdyenNotifications.amountCurrency(item);
        String account = AdyenNotifications.text(item, "merchantAccountCode");
        if (reference == null || !reference.startsWith("INV-") || value == null
                || (account != null && !account.equals(merchantAccount))) {
            return Optional.empty();
        }
        List<Invoice> candidates = invoiceRepository.findByNumberAndStatus(reference, Invoice.Status.SENT).stream()
                .filter(invoice -> invoice.getTotal().equals(value))
                .filter(invoice -> currency == null || currency.equals(invoice.getCurrency()))
                .toList();
        return candidates.size() == 1 ? Optional.of(candidates.get(0)) : Optional.empty();
    }

    /**
     * The invoice of a subscription charge, by the order reference of its charges, the reference of the Auto Rescue
     * retrying it, or the payment of its last charge.
     */
    private Optional<Invoice> findCharged(JsonNode item) {
        String orderReference = AdyenNotifications.additionalData(item, "merchantOrderReference");
        if (orderReference != null) {
            Optional<Invoice> invoice = invoiceRepository.findFirstByChargeReference(orderReference);
            if (invoice.isPresent()) {
                return invoice;
            }
        }
        String rescueReference = AdyenNotifications.additionalData(item, "retry.rescueReference");
        if (rescueReference != null) {
            Optional<Invoice> invoice = invoiceRepository.findFirstByRescueReference(rescueReference);
            if (invoice.isPresent()) {
                return invoice;
            }
        }
        String pspReference = AdyenNotifications.text(item, "pspReference");
        return pspReference != null ? invoiceRepository.findFirstByChargePspReference(pspReference) : Optional.empty();
    }

    /**
     * The invoice a notification is about: the one its payment pays, else the one whose payment it follows up (a
     * capture, a refund, the payment method it stored, the cancellation of an Auto Rescue...).
     */
    public Optional<Invoice> findForNotification(JsonNode item) {
        Optional<Invoice> invoice = findForPayment(item);
        if (invoice.isPresent()) {
            return invoice;
        }
        String pspReference = AdyenNotifications.text(item, "pspReference");
        if (pspReference != null) {
            invoice = invoiceRepository.findFirstByPspReference(pspReference);
            if (invoice.isPresent()) {
                return invoice;
            }
        }
        String originalReference = AdyenNotifications.text(item, "originalReference");
        if (originalReference == null) {
            return Optional.empty();
        }
        return invoiceRepository.findFirstByPspReference(originalReference)
                .or(() -> invoiceRepository.findFirstByChargePspReference(originalReference))
                .or(() -> invoiceRepository.findFirstByRescueReference(originalReference));
    }

    /** The user of the invoice a notification is about, so that it shows in their notifications. */
    public Optional<String> userIdOf(JsonNode item) {
        return findForNotification(item).map(Invoice::getUserId);
    }

    /** Returns true when the invoice changed. */
    private boolean applyAuthorisation(Invoice invoice, JsonNode item) {
        String pspReference = AdyenNotifications.text(item, "pspReference");
        String paymentMethod = AdyenNotifications.text(item, "paymentMethod");
        Instant at = Objects.requireNonNullElseGet(AdyenNotifications.eventDate(item), Instant::now);
        boolean charge = isCharge(invoice, item);
        String retry = AdyenNotifications.additionalData(item, "retry.orderAttemptNumber");
        if (!AdyenNotifications.success(item)) {
            boolean known = invoice.getEvents().stream().anyMatch(event ->
                    event.getType() == InvoiceEvent.Type.PAYMENT_REFUSED && Objects.equals(event.getPspReference(), pspReference));
            if (known || invoice.getStatus() == Invoice.Status.PAID) {
                return false;
            }
            String reason = AdyenNotifications.text(item, "reason");
            boolean rescueScheduled = charge
                    && "true".equalsIgnoreCase(AdyenNotifications.additionalData(item, "retry.rescueScheduled"));
            if (charge && invoice.getStatus() == Invoice.Status.SENT) {
                invoice.setChargeStatus(rescueScheduled ? Invoice.ChargeStatus.RESCUING : Invoice.ChargeStatus.REFUSED);
                invoice.setChargeRefusalReason(truncate(reason, 200));
                String rescueReference = AdyenNotifications.additionalData(item, "retry.rescueReference");
                if (rescueReference != null) {
                    invoice.setRescueReference(rescueReference);
                }
            }
            String refused = retry != null ? "Auto Rescue retry " + retry + " refused" : "Payment" + by(paymentMethod) + " refused";
            invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, at, refused + (reason != null ? ": " + reason : "") + "."
                    + (rescueScheduled ? " Auto Rescue will retry it." : ""), pspReference);
            return true;
        }
        if (charge && invoice.getStatus() == Invoice.Status.SENT) {
            invoice.setChargeStatus(Invoice.ChargeStatus.AUTHORISED);
            invoice.setChargeRefusalReason(null);
        }
        String paid = "Paid" + by(paymentMethod) + (retry != null ? ": Auto Rescue retry " + retry + " succeeded." : ".");
        if (invoice.getStatus() == Invoice.Status.PAID) {
            if (invoice.getPspReference() != null || pspReference == null) {
                return false;
            }
            // Paid according to its payment link before the webhook arrived: the webhook tells how.
            invoice.setPspReference(pspReference);
            invoice.setPaymentMethod(paymentMethod);
            invoice.getEvents().stream()
                    .filter(event -> event.getType() == InvoiceEvent.Type.PAID)
                    .reduce((first, second) -> second)
                    .ifPresent(event -> {
                        event.setPspReference(pspReference);
                        event.setDetail(paid);
                    });
            return true;
        }
        return markPaid(invoice, pspReference, paymentMethod, at, paid);
    }

    /** Whether the notification is about a charge of the invoice to a stored payment method, rather than its link. */
    private static boolean isCharge(Invoice invoice, JsonNode item) {
        if (invoice.getChargeStatus() == null || AdyenNotifications.additionalData(item, "paymentLinkId") != null) {
            return false;
        }
        String rescueReference = AdyenNotifications.additionalData(item, "retry.rescueReference");
        return Objects.equals(invoice.getChargeReference(), AdyenNotifications.additionalData(item, "merchantOrderReference"))
                || Objects.equals(invoice.getChargePspReference(), AdyenNotifications.text(item, "pspReference"))
                || (rescueReference != null && rescueReference.equals(invoice.getRescueReference()));
    }

    /** The end of an Auto Rescue, or its cancellation. Returns true when the invoice changed. */
    private boolean applyRescueOutcome(Invoice invoice, JsonNode item, String eventCode) {
        if (invoice.getStatus() != Invoice.Status.SENT || invoice.getChargeStatus() != Invoice.ChargeStatus.RESCUING) {
            return false;
        }
        boolean success = AdyenNotifications.success(item);
        String pspReference = AdyenNotifications.text(item, "pspReference");
        Instant now = Instant.now();
        if (AUTORESCUE.equals(eventCode)) {
            if (success) {
                // The AUTHORISATION webhook of the retry that succeeded marks the invoice paid.
                invoice.setChargeStatus(Invoice.ChargeStatus.AUTHORISED);
                return true;
            }
            invoice.setChargeStatus(Invoice.ChargeStatus.REFUSED);
            invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, now, "Auto Rescue ended without recovering the payment: "
                    + rescueEndReason(AdyenNotifications.text(item, "reason")) + ".", pspReference);
            return true;
        }
        if (!success) {
            log.warn("Adyen couldn't stop the Auto Rescue of invoice {}: {}", invoice.getNumber(),
                    AdyenNotifications.text(item, "reason"));
            return false;
        }
        invoice.setChargeStatus(Invoice.ChargeStatus.REFUSED);
        invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, now, "Auto Rescue stopped: the charge won't be retried.",
                pspReference);
        return true;
    }

    /** Why an Auto Rescue ended without recovering the payment, for people. */
    static String rescueEndReason(String reason) {
        if (reason == null) {
            return "no reason given";
        }
        return switch (reason) {
            case "retryWindowHasElapsed" -> "the retry window elapsed";
            case "maxRetryAttemptsReached" -> "the maximum number of retries was reached";
            case "fraudDecline" -> "a retry was declined as fraud";
            case "internalError" -> "an internal error occurred";
            default -> reason;
        };
    }

    /**
     * Settles the open payment links that no webhook settled: with the webhooks another backend sharing the database
     * stored, else by asking Adyen. Each link is checked once per interval at most. Returns true when an invoice changed.
     */
    private boolean checkOpenLinks(List<Invoice> invoices, Duration interval, int max, Instant now) {
        List<Invoice> due = invoices.stream()
                .filter(invoice -> linkCheckDue(invoice, interval, now))
                .sorted(Comparator.comparing(Invoice::getPaymentLinkCheckedAt, Comparator.nullsFirst(Comparator.naturalOrder())))
                .limit(max)
                .toList();
        for (Invoice found : due) {
            synchronized (lockOf(found.getId())) {
                Invoice invoice = current(found);
                if (!linkCheckDue(invoice, interval, now)) {
                    continue; // settled, or just checked, by another request
                }
                applyStoredWebhooks(invoice);
                if (invoice.getStatus() == Invoice.Status.SENT) {
                    try {
                        applyLinkStatus(invoice, paymentLinksApi.getPaymentLink(invoice.getPaymentLinkId()), now);
                    } catch (Exception e) {
                        log.warn("Couldn't check the payment link of invoice {}: {}", invoice.getNumber(), e.getMessage());
                    }
                }
                invoice.setPaymentLinkCheckedAt(now);
                invoiceRepository.save(invoice);
            }
        }
        return !due.isEmpty();
    }

    private static boolean linkCheckDue(Invoice invoice, Duration interval, Instant now) {
        return invoice.getStatus() == Invoice.Status.SENT && invoice.getPaymentLinkId() != null
                && !LINK_EXPIRED.equals(invoice.getPaymentLinkStatus())
                && (invoice.getPaymentLinkCheckedAt() == null || !invoice.getPaymentLinkCheckedAt().plus(interval).isAfter(now));
    }

    private void applyStoredWebhooks(Invoice invoice) {
        try {
            String paymentLinkId = invoice.getPaymentLinkId();
            for (WebhookEvent event : webhookEventRepository
                    .findByEventTypeAndRawJsonContainingOrderByReceivedAtAsc(AUTHORISATION, paymentLinkId)) {
                for (JsonNode item : AdyenNotifications.items(objectMapper, event.getRawJson())) {
                    if (AUTHORISATION.equals(AdyenNotifications.text(item, "eventCode"))
                            && paymentLinkId.equals(AdyenNotifications.additionalData(item, "paymentLinkId"))) {
                        applyAuthorisation(invoice, item);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Couldn't read the stored webhooks of invoice {}: {}", invoice.getNumber(), e.getMessage());
        }
    }

    private void applyLinkStatus(Invoice invoice, PaymentLinkResponse link, Instant now) {
        if (link.getStatus() == null) {
            return;
        }
        String previous = invoice.getPaymentLinkStatus();
        String status = link.getStatus().getValue();
        invoice.setPaymentLinkStatus(status);
        switch (link.getStatus()) {
            case COMPLETED, PAID -> markPaid(invoice, null, null,
                    link.getUpdatedAt() != null ? link.getUpdatedAt().toInstant() : now,
                    "Paid with the payment link.");
            case PAYMENTPENDING -> {
                if (!status.equals(previous)) {
                    invoice.addEvent(InvoiceEvent.Type.PAYMENT_PENDING, now,
                            "The customer paid. Waiting for confirmation.", null);
                }
            }
            case EXPIRED -> {
                if (!status.equals(previous)) {
                    Instant expiredAt = invoice.getPaymentLinkExpiresAt() != null && invoice.getPaymentLinkExpiresAt().isBefore(now)
                            ? invoice.getPaymentLinkExpiresAt()
                            : now;
                    invoice.addEvent(InvoiceEvent.Type.LINK_EXPIRED, expiredAt, "The payment link expired.", null);
                }
            }
            case ACTIVE -> {
            }
        }
    }

    private static boolean markPaid(Invoice invoice, String pspReference, String paymentMethod, Instant paidAt,
                                    String detail) {
        if (invoice.getStatus() == Invoice.Status.PAID) {
            return false;
        }
        invoice.setStatus(Invoice.Status.PAID);
        invoice.setPaidAt(paidAt);
        invoice.setPspReference(pspReference);
        invoice.setPaymentMethod(paymentMethod);
        invoice.addEvent(InvoiceEvent.Type.PAID, paidAt, detail, pspReference);
        return true;
    }

    // ---------- Subscription charges ----------

    /**
     * Charges an invoice of a subscription to the payment method the customer stored, as a payment they don't take
     * part in. Under the lock of the invoice, so a double click doesn't charge it twice. When Adyen rejects the
     * request, the attempt shows in the timeline of the invoice and the exception is thrown.
     */
    ChargeResult charge(Long invoiceId, Charge charge) throws IOException, ApiException {
        synchronized (lockOf(invoiceId)) {
            Invoice invoice = currentById(invoiceId);
            if (invoice.getSubscriptionId() == null || invoice.getChargeReference() == null) {
                throw new ConflictException("Only the invoices of a subscription can be charged to a stored payment method.");
            }
            switch (invoice.getStatus()) {
                case PAID -> throw new ConflictException("This invoice is already paid.");
                case VOID -> throw new ConflictException("A void invoice can't be charged.");
                default -> {
                }
            }
            String charging = chargeInProgress(invoice);
            if (charging != null) {
                throw new ConflictException(charging);
            }
            User user = user(invoice.getUserId());
            String issue = paymentLinksIssue(user);
            if (issue != null) {
                throw new BadRequestException(issue);
            }
            Instant now = Instant.now();
            closeLink(invoice, now, "charged");
            int attempt = Objects.requireNonNullElse(invoice.getChargeAttempts(), 0) + 1;
            PaymentResponse response;
            try {
                response = paymentsApi.payments(chargeRequest(user, invoice, charge),
                        new RequestOptions().idempotencyKey(invoice.getChargeReference() + "-" + attempt));
            } catch (ApiException e) {
                if (e.getStatusCode() >= 400 && e.getStatusCode() < 500) {
                    // Adyen answered, so the next charge is a new request: it gets its own idempotency key.
                    invoice.setChargeAttempts(attempt);
                    String reason = BillService.adyenError(e);
                    invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, now, "The charge to " + charge.methodLabel()
                            + " was rejected" + (reason != null ? ": " + reason : "") + ".", null);
                }
                invoiceRepository.save(invoice);
                throw e;
            } catch (IOException e) {
                // The charge may have reached Adyen: the next one reuses its idempotency key, so it's taken once.
                invoiceRepository.save(invoice);
                throw e;
            }

            String pspReference = response.getPspReference();
            invoice.setChargeAttempts(attempt);
            invoice.setChargedAt(now);
            invoice.setChargePspReference(pspReference);
            invoice.setRescueReference(null);
            if (invoice.getSentAt() == null) {
                // Charging issues the invoice: the ledger books it from then.
                invoice.setSentAt(now);
            }
            invoice.setStatus(Invoice.Status.SENT);
            Map<String, String> additionalData = Objects.requireNonNullElse(response.getAdditionalData(), Map.of());
            PaymentResponse.ResultCodeEnum resultCode = response.getResultCode();
            String to = " to " + charge.methodLabel();
            String refusalReason = null;
            Invoice.ChargeStatus status;
            if (resultCode == PaymentResponse.ResultCodeEnum.AUTHORISED) {
                status = Invoice.ChargeStatus.AUTHORISED;
                invoice.setChargeRefusalReason(null);
                markPaid(invoice, pspReference, charge.paymentMethodVariant(), now, "Paid: charged" + to + ".");
            } else if (resultCode == PaymentResponse.ResultCodeEnum.PENDING
                    || resultCode == PaymentResponse.ResultCodeEnum.RECEIVED) {
                status = Invoice.ChargeStatus.PENDING;
                invoice.setChargeRefusalReason(null);
                invoice.addEvent(InvoiceEvent.Type.CHARGE_SUBMITTED, now,
                        "Charged" + to + ": waiting for confirmation.", pspReference);
            } else {
                refusalReason = response.getRefusalReason() != null ? response.getRefusalReason()
                        : resultCode != null ? resultCode.getValue() : "no result given";
                boolean rescue = "true".equalsIgnoreCase(additionalData.get("retry.rescueScheduled"));
                status = rescue ? Invoice.ChargeStatus.RESCUING : Invoice.ChargeStatus.REFUSED;
                invoice.setChargeRefusalReason(truncate(refusalReason, 200));
                invoice.setRescueReference(rescue ? additionalData.get("retry.rescueReference") : null);
                invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, now, "Charge" + to + " refused: " + refusalReason + "."
                        + (rescue ? " Auto Rescue will retry it." : ""), pspReference);
            }
            invoice.setChargeStatus(status);
            Invoice saved = invoiceRepository.save(invoice);
            log.info("Invoice {} charged to a stored payment method: {} ({})", saved.getNumber(), resultCode, pspReference);
            return new ChargeResult(saved, status, pspReference, refusalReason);
        }
    }

    private PaymentRequest chargeRequest(User user, Invoice invoice, Charge charge) {
        String storeReference = embedded(user) ? storeReference(user) : null;
        ResolvedPaymentOptions options = checkoutPaymentService.resolve(null, target(user, storeReference),
                invoice.getTotal(), invoice.getCurrency(), invoice.getNumber());
        CheckoutPaymentMethod paymentMethod = SEPA_DIRECT_DEBIT.equals(charge.paymentMethodVariant())
                ? new CheckoutPaymentMethod(new SepaDirectDebitDetails()
                .type(SepaDirectDebitDetails.TypeEnum.SEPADIRECTDEBIT)
                .storedPaymentMethodId(charge.storedPaymentMethodId()))
                : new CheckoutPaymentMethod(new CardDetails().storedPaymentMethodId(charge.storedPaymentMethodId()));
        PaymentRequest request = new PaymentRequest()
                .merchantAccount(merchantAccount)
                .reference(invoice.getNumber())
                .merchantOrderReference(invoice.getChargeReference())
                .amount(new Amount().currency(invoice.getCurrency()).value(invoice.getTotal()))
                .shopperReference(charge.shopperReference())
                .shopperEmail(invoice.getCustomer().getEmail())
                .shopperInteraction(PaymentRequest.ShopperInteractionEnum.CONTAUTH)
                .recurringProcessingModel(PaymentRequest.RecurringProcessingModelEnum.SUBSCRIPTION)
                .paymentMethod(paymentMethod);
        if (storeReference != null) {
            request.store(storeReference);
        }
        // Before the additional data below: manual capture replaces the additional data of the request.
        options.applyTo(request);
        if (charge.autoRescue()) {
            request.putAdditionalDataItem("autoRescue", "true");
            request.putAdditionalDataItem("maxDaysToRescue", String.valueOf(charge.rescueDays()));
            if (charge.testScenario() != null) {
                request.putAdditionalDataItem("autoRescueScenario", charge.testScenario());
            }
        }
        if (charge.testRefusal() != null) {
            request.putAdditionalDataItem("RequestedTestAcquirerResponseCode", charge.testRefusal());
        }
        return request;
    }

    /**
     * Stops Auto Rescue from retrying the refused charge of an invoice. Adyen confirms it with a webhook, which the
     * invoice doesn't wait for: without webhooks, it would stay rescuing.
     */
    Invoice stopRescue(Long invoiceId) throws IOException, ApiException {
        synchronized (lockOf(invoiceId)) {
            Invoice invoice = currentById(invoiceId);
            if (invoice.getStatus() != Invoice.Status.SENT || invoice.getChargeStatus() != Invoice.ChargeStatus.RESCUING) {
                throw new ConflictException("Auto Rescue isn't retrying the charge of " + invoice.getNumber() + ".");
            }
            if (invoice.getRescueReference() == null) {
                throw new ConflictException("The charge of " + invoice.getNumber()
                        + " has no Auto Rescue reference, so its rescue can't be stopped.");
            }
            ModificationResult result = modificationsApi.cancel(new CancelRequest()
                    .merchantAccount(merchantAccount)
                    .originalReference(invoice.getRescueReference())
                    .putAdditionalDataItem("cancellationType", "autoRescue"));
            invoice.setChargeStatus(Invoice.ChargeStatus.REFUSED);
            invoice.addEvent(InvoiceEvent.Type.PAYMENT_REFUSED, Instant.now(),
                    "Auto Rescue stopped: the charge won't be retried.", result.getPspReference());
            return invoiceRepository.save(invoice);
        }
    }

    /** Why the invoice can't be sent, charged or voided while Adyen settles its charge, null when it can. */
    private static String chargeInProgress(Invoice invoice) {
        if (invoice.getStatus() != Invoice.Status.SENT || invoice.getChargeStatus() == null) {
            return null;
        }
        return switch (invoice.getChargeStatus()) {
            case PENDING -> "The charge of " + invoice.getNumber() + " isn't confirmed yet. Try again once it is.";
            case RESCUING -> "Auto Rescue is retrying the charge of " + invoice.getNumber()
                    + ". Stop it from the subscription first.";
            default -> null;
        };
    }

    /**
     * Settles the charges Adyen hasn't confirmed, and those Auto Rescue retries, with the webhooks another backend
     * sharing the database stored. Each charge is looked up once per interval at most. Returns true when an invoice
     * changed.
     */
    private boolean checkCharges(List<Invoice> invoices, Instant now) {
        boolean changed = false;
        for (Invoice found : invoices) {
            if (!chargeUnsettled(found)) {
                continue;
            }
            Instant checkedAt = chargeCheckedAt.get(found.getId());
            if (checkedAt != null && checkedAt.plus(CHARGE_CHECK_INTERVAL).isAfter(now)) {
                continue;
            }
            chargeCheckedAt.put(found.getId(), now);
            synchronized (lockOf(found.getId())) {
                Invoice invoice = current(found);
                if (chargeUnsettled(invoice) && applyStoredChargeWebhooks(invoice)) {
                    invoiceRepository.save(invoice);
                    changed = true;
                }
            }
        }
        return changed;
    }

    private static boolean chargeUnsettled(Invoice invoice) {
        return invoice.getStatus() == Invoice.Status.SENT && (invoice.getChargeStatus() == Invoice.ChargeStatus.PENDING
                || invoice.getChargeStatus() == Invoice.ChargeStatus.RESCUING);
    }

    /** Returns true when the invoice changed. */
    private boolean applyStoredChargeWebhooks(Invoice invoice) {
        boolean changed = false;
        try {
            // By id: the order they were received in.
            Map<Long, WebhookEvent> events = new TreeMap<>();
            List<String[]> lookups = new ArrayList<>();
            lookups.add(new String[]{AUTHORISATION, invoice.getChargeReference()});
            if (invoice.getChargePspReference() != null) {
                lookups.add(new String[]{AUTHORISATION, invoice.getChargePspReference()});
            }
            if (invoice.getChargeStatus() == Invoice.ChargeStatus.RESCUING) {
                lookups.add(new String[]{AUTORESCUE, invoice.getChargeReference()});
                lookups.add(new String[]{CANCEL_AUTORESCUE, invoice.getChargeReference()});
            }
            for (String[] lookup : lookups) {
                webhookEventRepository.findByEventTypeAndRawJsonContainingOrderByReceivedAtAsc(lookup[0], lookup[1])
                        .forEach(event -> events.put(event.getId(), event));
            }
            for (WebhookEvent event : events.values()) {
                for (JsonNode item : AdyenNotifications.items(objectMapper, event.getRawJson())) {
                    String eventCode = AdyenNotifications.text(item, "eventCode");
                    if (!isCharge(invoice, item)) {
                        continue;
                    }
                    if (AUTHORISATION.equals(eventCode)) {
                        changed |= applyAuthorisation(invoice, item);
                    } else if (AUTORESCUE.equals(eventCode) || CANCEL_AUTORESCUE.equals(eventCode)) {
                        changed |= applyRescueOutcome(invoice, item, eventCode);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Couldn't read the stored webhooks of the charges of invoice {}: {}", invoice.getNumber(), e.getMessage());
        }
        return changed;
    }

    // ---------- Payment links ----------

    /** Why the user can't send invoices with a payment link yet, null when they can. */
    String paymentLinksIssue(User user) {
        if (user.getLegalEntityId() == null) {
            return "Finish the sign-up first: the account has no legal entity yet.";
        }
        if (embedded(user)) {
            return storeReference(user) == null
                    ? "Create a store first: with embedded payments, a store processes the payments of the invoices."
                    : null;
        }
        if ("marketplace".equals(user.getActivityReason())
                && (user.getBalanceAccountId() == null || user.getBalanceAccountId().isBlank())) {
            return "The account has no balance account to receive the payments yet.";
        }
        return null;
    }

    private PaymentLinkRequest linkRequest(User user, Invoice invoice, String storeReference, OffsetDateTime expiresAt) {
        Customer customer = invoice.getCustomer();
        ResolvedPaymentOptions options = checkoutPaymentService.resolve(null, target(user, storeReference),
                invoice.getTotal(), invoice.getCurrency(), invoice.getNumber());
        PaymentLinkRequest request = new PaymentLinkRequest()
                .merchantAccount(merchantAccount)
                .reference(invoice.getNumber())
                .amount(new Amount().currency(invoice.getCurrency()).value(invoice.getTotal()))
                .description("Invoice " + invoice.getNumber())
                .shopperEmail(customer.getEmail())
                .shopperReference(customer.getShopperReference())
                .expiresAt(expiresAt)
                .lineItems(lineItems(invoice));
        String country = customer.getCountry() != null ? customer.getCountry() : user.getCountryCode();
        if (country != null) {
            request.countryCode(country);
        }
        if (storeReference != null) {
            request.store(storeReference);
        }
        if (invoice.getSubscriptionId() != null) {
            // Paying stores the payment method: the next billing cycles of the subscription are charged to it.
            request.storePaymentMethodMode(PaymentLinkRequest.StorePaymentMethodModeEnum.ENABLED)
                    .recurringProcessingModel(PaymentLinkRequest.RecurringProcessingModelEnum.SUBSCRIPTION);
        }
        options.applyTo(request);
        return request;
    }

    /** Where the payments of the user's invoices go. */
    private ResolvedPaymentOptions.Target target(User user, String storeReference) {
        return new ResolvedPaymentOptions.Target(PaymentResultRedirects.SOURCE_CHECKOUT, merchantAccount, user.getId(),
                user.getId(), user.getActivityReason(), user.getBalanceAccountId(), storeReference);
    }

    private static List<LineItem> lineItems(Invoice invoice) {
        List<LineItem> items = new ArrayList<>();
        for (InvoiceLine line : invoice.getLines()) {
            InvoiceMath.Amounts amounts = new InvoiceMath.Amounts(line.getNetAmount(), line.getTaxAmount(), line.getGrossAmount());
            InvoiceMath.Amounts unit = InvoiceMath.perUnit(line.getQuantity(), amounts);
            LineItem item = new LineItem()
                    .id(String.valueOf(line.getSortOrder() + 1))
                    .taxPercentage(InvoiceMath.adyenTaxPercentage(line.getVatRate()));
            if (unit != null) {
                item.description(line.getDescription())
                        .quantity(line.getQuantity())
                        .amountExcludingTax(unit.net())
                        .taxAmount(unit.tax())
                        .amountIncludingTax(unit.gross());
            } else {
                item.description(line.getQuantity() + " × " + line.getDescription())
                        .quantity(1L)
                        .amountExcludingTax(amounts.net())
                        .taxAmount(amounts.tax())
                        .amountIncludingTax(amounts.gross());
            }
            items.add(item);
        }
        return items;
    }

    /** The end of the due date, kept between a week and Adyen's 70 days from now. */
    static OffsetDateTime linkExpiry(LocalDate dueDate, Instant now) {
        Instant endOfDueDate = dueDate.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().minusSeconds(1);
        Instant earliest = now.plus(MIN_LINK_VALIDITY);
        Instant latest = now.plus(MAX_LINK_VALIDITY);
        Instant expiry = endOfDueDate.isBefore(earliest) ? earliest : endOfDueDate.isAfter(latest) ? latest : endOfDueDate;
        return expiry.truncatedTo(ChronoUnit.SECONDS).atOffset(ZoneOffset.UTC);
    }

    static boolean linkExpired(Invoice invoice, Instant now) {
        return invoice.getPaymentLinkId() == null
                || LINK_EXPIRED.equals(invoice.getPaymentLinkStatus())
                || (invoice.getPaymentLinkExpiresAt() != null && !invoice.getPaymentLinkExpiresAt().isAfter(now));
    }

    private static boolean embedded(User user) {
        return "embeddedPayment".equals(user.getActivityReason());
    }

    /** The first store of the user: it processes the payments of its invoices. */
    private String storeReference(User user) {
        return storeCustomerRepository.findByUserIdOrderByIdAsc(user.getId()).stream()
                .map(StoreCustomer::getStoreRef)
                .filter(reference -> reference != null && !reference.isBlank())
                .findFirst()
                .orElse(null);
    }

    // ---------- Validation and mapping ----------

    private void apply(Invoice invoice, InvoiceRequest request, String userId) {
        if (request == null) {
            throw new BadRequestException("The invoice is missing.");
        }
        Customer customer = request.customerId() == null ? null
                : customerRepository.findByIdAndUserId(request.customerId(), userId).orElse(null);
        if (customer == null) {
            throw new BadRequestException("Choose a customer.");
        }
        LocalDate issueDate = request.issueDate() != null ? request.issueDate() : today();
        LocalDate dueDate = request.dueDate() != null ? request.dueDate() : issueDate.plusDays(PAYMENT_TERMS_DAYS);
        if (dueDate.isBefore(issueDate)) {
            throw new BadRequestException("The due date can't be before the issue date.");
        }
        List<InvoiceRequest.Line> requested = request.lines() != null ? request.lines() : List.of();
        if (requested.isEmpty()) {
            throw new BadRequestException("Add at least one line.");
        }
        if (requested.size() > MAX_LINES) {
            throw new BadRequestException("An invoice can have up to " + MAX_LINES + " lines.");
        }
        List<InvoiceLine> lines = new ArrayList<>();
        for (int i = 0; i < requested.size(); i++) {
            lines.add(line(requested.get(i), i));
        }
        InvoiceMath.Totals totals;
        try {
            totals = totals(lines);
        } catch (ArithmeticException e) {
            throw new BadRequestException("The invoice total is too large.");
        }
        if (totals.gross() <= 0) {
            throw new BadRequestException("The invoice total must be greater than 0.");
        }
        String notes = trimToNull(request.notes());
        if (notes != null && notes.length() > MAX_NOTES) {
            throw new BadRequestException("The notes can have up to " + MAX_NOTES + " characters.");
        }
        invoice.setCustomer(customer);
        invoice.setIssueDate(issueDate);
        invoice.setDueDate(dueDate);
        invoice.setNotes(notes);
        invoice.replaceLines(lines);
        invoice.setSubtotal(totals.net());
        invoice.setTaxTotal(totals.tax());
        invoice.setTotal(totals.gross());
    }

    private static InvoiceLine line(InvoiceRequest.Line requested, int index) {
        String position = "Line " + (index + 1);
        if (requested == null) {
            throw new BadRequestException(position + " is empty.");
        }
        String description = trimToNull(requested.description());
        if (description == null) {
            throw new BadRequestException(position + ": enter a description.");
        }
        if (description.length() > MAX_DESCRIPTION) {
            throw new BadRequestException(position + ": the description can have up to " + MAX_DESCRIPTION + " characters.");
        }
        Long quantity = requested.quantity();
        if (quantity == null || quantity < 1 || quantity > MAX_QUANTITY) {
            throw new BadRequestException(position + ": the quantity must be a whole number between 1 and 1,000,000.");
        }
        Long unitPrice = requested.unitPrice();
        if (unitPrice == null || unitPrice < 0 || unitPrice > MAX_UNIT_PRICE) {
            throw new BadRequestException(position + ": enter a unit price of 0 or more.");
        }
        BigDecimal vatRate = requested.vatRate() != null ? requested.vatRate() : BigDecimal.ZERO;
        if (vatRate.signum() < 0 || vatRate.compareTo(HUNDRED) > 0) {
            throw new BadRequestException(position + ": the tax rate must be between 0 and 100%.");
        }
        if (vatRate.stripTrailingZeros().scale() > 2) {
            throw new BadRequestException(position + ": the tax rate can have up to 2 decimals.");
        }
        InvoiceMath.Amounts amounts;
        try {
            amounts = InvoiceMath.line(quantity, unitPrice, vatRate);
        } catch (ArithmeticException e) {
            throw new BadRequestException(position + ": the amount is too large.");
        }
        InvoiceLine line = new InvoiceLine();
        line.setSortOrder(index);
        line.setDescription(description);
        line.setQuantity(quantity);
        line.setUnitPrice(unitPrice);
        line.setVatRate(vatRate.setScale(2));
        line.setNetAmount(amounts.net());
        line.setTaxAmount(amounts.tax());
        line.setGrossAmount(amounts.gross());
        return line;
    }

    private static InvoiceMath.Totals totals(List<InvoiceLine> lines) {
        return InvoiceMath.totals(lines.stream()
                .map(line -> new InvoiceMath.RatedAmounts(line.getVatRate(),
                        new InvoiceMath.Amounts(line.getNetAmount(), line.getTaxAmount(), line.getGrossAmount())))
                .toList());
    }

    private InvoiceDTO toDto(Invoice invoice, LocalDate today) {
        Instant now = Instant.now();
        Invoice.Status status = invoice.getStatus();
        boolean overdue = status == Invoice.Status.SENT && invoice.getDueDate().isBefore(today);
        Customer customer = invoice.getCustomer();
        InvoiceDTO.CustomerRef customerRef = new InvoiceDTO.CustomerRef(customer.getId(), customer.displayName(),
                customer.getName(), customer.getCompany(), customer.getEmail(), customer.getCountry(),
                customer.getVatNumber(), customer.getAddressLine(), customer.getPostalCode(), customer.getCity());
        List<InvoiceDTO.Line> lines = invoice.getLines().stream()
                .map(line -> new InvoiceDTO.Line(line.getDescription(), line.getQuantity(), line.getUnitPrice(),
                        line.getVatRate(), line.getNetAmount(), line.getTaxAmount(), line.getGrossAmount()))
                .toList();
        List<InvoiceDTO.Vat> vat = totals(invoice.getLines()).vat().stream()
                .map(group -> new InvoiceDTO.Vat(group.rate(), group.base(), group.tax()))
                .toList();
        InvoiceDTO.PaymentLink link = invoice.getPaymentLinkId() == null ? null
                : new InvoiceDTO.PaymentLink(invoice.getPaymentLinkId(),
                PaymentLinks.pageUrl(invoice.getPaymentLinkUrl()), invoice.getPaymentLinkStatus(),
                invoice.getPaymentLinkExpiresAt(), invoice.getPaymentLinkCheckedAt());
        List<InvoiceDTO.Event> events = invoice.getEvents().stream()
                .sorted(Comparator.comparing(InvoiceEvent::getOccurredAt))
                .map(event -> new InvoiceDTO.Event(event.getType().name(), event.getOccurredAt(), event.getDetail(),
                        event.getPspReference()))
                .toList();
        InvoiceDTO.Charge charge = invoice.getChargeStatus() == null ? null
                : new InvoiceDTO.Charge(invoice.getChargeStatus().name(), invoice.getChargeRefusalReason(),
                Objects.requireNonNullElse(invoice.getChargeAttempts(), 0), invoice.getChargedAt());
        boolean open = status == Invoice.Status.DRAFT || status == Invoice.Status.SENT;
        boolean subscription = invoice.getSubscriptionId() != null;
        return new InvoiceDTO(
                invoice.getId(),
                invoice.getNumber(),
                overdue ? "OVERDUE" : status.name(),
                overdue ? ChronoUnit.DAYS.between(invoice.getDueDate(), today) : null,
                customerRef,
                invoice.getIssueDate(),
                invoice.getDueDate(),
                invoice.getCurrency(),
                invoice.getSubtotal(),
                invoice.getTaxTotal(),
                invoice.getTotal(),
                open ? invoice.getTotal() : 0,
                lines,
                vat,
                invoice.getNotes(),
                link,
                invoice.getPspReference(),
                invoice.getPaymentMethod(),
                PaymentMethodNames.of(invoice.getPaymentMethod()),
                invoice.getStoreReference(),
                invoice.getCreatedAt(),
                invoice.getSentAt(),
                invoice.getPaidAt(),
                invoice.getVoidedAt(),
                invoice.getSubscriptionId(),
                invoice.getSubscriptionCycle(),
                charge,
                events,
                status == Invoice.Status.DRAFT && !subscription,
                chargeInProgress(invoice) == null
                        && (status == Invoice.Status.DRAFT || (status == Invoice.Status.SENT && linkExpired(invoice, now))),
                open && !subscription);
    }

    /** The seller as Adyen verified it, else the name the user signed up with. */
    private LegalEntityService.Identity seller(User user) {
        if (user.getLegalEntityId() != null) {
            try {
                LegalEntityService.Identity identity = legalEntityService.getIdentity(user.getLegalEntityId());
                if (identity != null) {
                    return identity;
                }
            } catch (Exception e) {
                log.warn("Invoice PDF of user {} created without the legal entity details: {}", user.getId(), e.getMessage());
            }
        }
        String name = user.getLegalEntityName() != null && !user.getLegalEntityName().isBlank()
                ? user.getLegalEntityName().trim()
                : (Objects.toString(user.getFirstName(), "") + " " + Objects.toString(user.getLastName(), "")).trim();
        return new LegalEntityService.Identity(name, null, List.of());
    }

    private int nextSequenceNumber(String userId, int year) {
        Integer last = invoiceRepository.maxSequenceNumber(userId, year);
        return (last != null ? last : 0) + 1;
    }

    private static String formatNumber(int year, int sequenceNumber) {
        return String.format(Locale.ROOT, "INV-%d-%04d", year, sequenceNumber);
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private Invoice owned(String userId, Long invoiceId) {
        return invoiceRepository.findByIdAndUserId(invoiceId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Invoice not found"));
    }

    private Object lockOf(Long invoiceId) {
        return invoiceLocks[Math.floorMod(invoiceId.hashCode(), invoiceLocks.length)];
    }

    /**
     * The invoice as stored now, to change under its lock. The copy the request read before may be stale: Open Session
     * in View keeps it for the whole request, even after another thread changed the invoice.
     */
    private Invoice current(Invoice invoice) {
        entityManager.detach(invoice);
        return invoiceRepository.findById(invoice.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Invoice not found"));
    }

    private Invoice currentById(Long invoiceId) {
        return current(invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new ResourceNotFoundException("Invoice not found")));
    }

    /** Keeps a reference unique across the environments that share the merchant account. */
    private static String randomSuffix() {
        StringBuilder suffix = new StringBuilder(6);
        for (int i = 0; i < 6; i++) {
            suffix.append(REFERENCE_CHARACTERS.charAt(RANDOM.nextInt(REFERENCE_CHARACTERS.length())));
        }
        return suffix.toString();
    }

    private static String truncate(String value, int maxLength) {
        return value == null || value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    static String currency(User user) {
        return user.getCurrencyCode() != null && !user.getCurrencyCode().isBlank() ? user.getCurrencyCode() : "EUR";
    }

    static LocalDate today() {
        return LocalDate.now(ZoneOffset.UTC);
    }

    private static String by(String paymentMethod) {
        String name = PaymentMethodNames.of(paymentMethod);
        return name != null ? " by " + name : "";
    }

    private static String day(Instant instant) {
        return DAY.format(instant.atZone(ZoneOffset.UTC));
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
