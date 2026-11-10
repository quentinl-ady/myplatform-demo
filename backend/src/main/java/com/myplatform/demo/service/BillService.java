package com.myplatform.demo.service;

import com.adyen.service.exception.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.BillCardRequest;
import com.myplatform.demo.dto.BillDTO;
import com.myplatform.demo.dto.BillPaymentRequest;
import com.myplatform.demo.dto.BillPaymentResultDTO;
import com.myplatform.demo.dto.BillRequest;
import com.myplatform.demo.dto.BillSettingsDTO;
import com.myplatform.demo.dto.BillTransferRoutesDTO;
import com.myplatform.demo.dto.CardNetworkOption;
import com.myplatform.demo.dto.CardResponse;
import com.myplatform.demo.dto.CardTransferDTO;
import com.myplatform.demo.dto.PayeeCheckDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.GlobalExceptionHandler;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.BillEvent;
import com.myplatform.demo.model.Card;
import com.myplatform.demo.model.CounterpartyVerificationResponse;
import com.myplatform.demo.model.RecipientCountry;
import com.myplatform.demo.model.Supplier;
import com.myplatform.demo.model.TransferRequest;
import com.myplatform.demo.model.TransferRouteOption;
import com.myplatform.demo.model.User;
import com.myplatform.demo.model.VerifyCounterpartyNameRequest;
import com.myplatform.demo.model.WebhookEvent;
import com.myplatform.demo.repository.BillRepository;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.SupplierRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import com.myplatform.demo.util.AdyenNotifications;
import com.myplatform.demo.util.BankDetails;
import com.myplatform.demo.util.ExpenseCategories;
import com.myplatform.demo.util.InvoiceMath;
import com.myplatform.demo.util.RecipientCountries;
import com.myplatform.demo.util.TransferStatuses;
import com.myplatform.demo.util.VatRates;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Currency;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Supplier bills: numbering, VAT, and their payment by a transfer from the business account or with a single-use
 * virtual card. A transfer waits for an approval with SCA on the Batch transfers page; the bill follows it with the
 * transfer webhooks, else by asking Adyen when the bills are opened. A bill paid by card is paid once the supplier
 * captured its payment with the card, which is then closed.
 */
@Service
public class BillService {

    private static final Logger log = LoggerFactory.getLogger(BillService.class);

    public static final int PAYMENT_TERMS_DAYS = 30;
    /** The result of a name check that can't run for the supplier's bank, or that failed. */
    static final String NOT_AVAILABLE = "notAvailable";
    static final String CHECK_ERROR = "error";
    /** How often a payment in progress is checked at Adyen, when no webhook settled it. */
    private static final Duration LIST_CHECK_INTERVAL = Duration.ofSeconds(20);
    private static final Duration DETAIL_CHECK_INTERVAL = Duration.ofSeconds(10);
    /** Keeps the list fast: the other payments are checked when it's opened again. */
    private static final int MAX_CHECKS_PER_LIST = 10;
    private static final int MAX_BATCH = 50;
    private static final long MAX_AMOUNT = 100_000_000_000L;
    private static final int MAX_SUPPLIER_REFERENCE = 40;
    private static final int MAX_DESCRIPTION = 200;
    private static final int MAX_CHECKED_NAME = 140;
    private static final int MAX_CARDHOLDER_NAME = 26;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final List<String> TRANSFER_TYPES = List.of("regular", "fast", "instant");
    private static final String TRANSFER_WEBHOOK = "balancePlatform.transfer.";
    private static final String CARD_ACTIVE = "active";
    private static final String CARD_CLOSED = "closed";
    /** Reasons that tell nothing about why a transfer failed. */
    private static final Set<String> GENERIC_REASONS = Set.of("approved", "pending", "unknown");

    private final BillRepository billRepository;
    private final SupplierRepository supplierRepository;
    private final UserRepository userRepository;
    private final CardRepository cardRepository;
    private final WebhookEventRepository webhookEventRepository;
    private final TransferService transferService;
    private final TransferRouteService transferRouteService;
    private final BankAccountResolver bankAccounts;
    private final BankValidationService bankValidationService;
    private final IssuingService issuingService;
    private final CardRangeCatalog cardRangeCatalog;
    private final CardTransferService cardTransferService;
    private final ObjectMapper objectMapper;
    private final EntityManager entityManager;
    /**
     * Webhooks, checks of payments and the user's actions change bills from different threads: the changes of a bill
     * run one at a time, under the lock its id maps to.
     */
    private final Object[] billLocks = Stream.generate(Object::new).limit(64).toArray();

    /** Why the user can't pay bills by transfer or by card yet, null when they can. */
    private record Context(String transfersIssue, String cardsIssue) {
    }

    private record PayeeCheck(String result, String name, String description, Instant checkedAt) {
    }

    /** The routes to the bank account of a supplier, or why they couldn't be calculated. */
    private record SupplierRoutes(List<TransferRouteOption> options, String error) {
    }

    /** A payment with a single-use card, from a webhook or from the payments of the card. */
    private record CardPayment(String transferId, String direction, String status, String reason, long amount,
                               String currency, String merchant, Instant at) {
    }

    public BillService(BillRepository billRepository,
                       SupplierRepository supplierRepository,
                       UserRepository userRepository,
                       CardRepository cardRepository,
                       WebhookEventRepository webhookEventRepository,
                       TransferService transferService,
                       TransferRouteService transferRouteService,
                       BankAccountResolver bankAccounts,
                       BankValidationService bankValidationService,
                       IssuingService issuingService,
                       CardRangeCatalog cardRangeCatalog,
                       CardTransferService cardTransferService,
                       ObjectMapper objectMapper,
                       EntityManager entityManager) {
        this.billRepository = billRepository;
        this.supplierRepository = supplierRepository;
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
        this.webhookEventRepository = webhookEventRepository;
        this.transferService = transferService;
        this.transferRouteService = transferRouteService;
        this.bankAccounts = bankAccounts;
        this.bankValidationService = bankValidationService;
        this.issuingService = issuingService;
        this.cardRangeCatalog = cardRangeCatalog;
        this.cardTransferService = cardTransferService;
        this.objectMapper = objectMapper;
        this.entityManager = entityManager;
    }

    // ---------- Read ----------

    public BillSettingsDTO settings(String userId) {
        User user = user(userId);
        String currency = InvoiceService.currency(user);
        String country = user.getCountryCode();
        List<BigDecimal> rates = VatRates.forCountry(country);
        int year = InvoiceService.today().getYear();
        return new BillSettingsDTO(currency, country, VatRates.taxLabel(country), rates, rates.get(0), PAYMENT_TERMS_DAYS,
                formatNumber(year, nextSequenceNumber(userId, year)), ExpenseCategories.ALL,
                SupplierService.bankAccountFormat(currency), RecipientCountries.forAccountCurrency(currency),
                transfersIssue(user), cardsIssue(user), cardBrands(currency));
    }

    /** The bills of the user, the latest number first. */
    public List<BillDTO> list(String userId) {
        User user = user(userId);
        List<Bill> bills = billRepository.findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId);
        if (checkPayments(user, bills, LIST_CHECK_INTERVAL, MAX_CHECKS_PER_LIST, Instant.now())) {
            bills = billRepository.findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId);
        }
        Context context = context(user);
        LocalDate today = InvoiceService.today();
        return bills.stream().map(bill -> toDto(bill, context, today)).toList();
    }

    public BillDTO get(String userId, Long billId) {
        User user = user(userId);
        Bill bill = owned(userId, billId);
        if (checkPayments(user, List.of(bill), DETAIL_CHECK_INTERVAL, 1, Instant.now())) {
            bill = owned(userId, billId);
        }
        return toDto(bill, context(user), InvoiceService.today());
    }

    // ---------- Write ----------

    public BillDTO create(String userId, BillRequest request) {
        return create(userId, request, null);
    }

    /**
     * Synchronized with no surrounding transaction, so the next bill reads the number this one saved.
     *
     * @param demoKey marks a bill of the demo data, null otherwise
     */
    synchronized BillDTO create(String userId, BillRequest request, String demoKey) {
        User user = user(userId);
        Bill bill = new Bill();
        bill.setUserId(userId);
        bill.setCurrency(InvoiceService.currency(user));
        bill.setStatus(Bill.Status.TO_PAY);
        bill.setDemoKey(demoKey);
        apply(bill, request, user);
        int year = bill.getIssueDate().getYear();
        int sequenceNumber = nextSequenceNumber(userId, year);
        bill.setSequenceYear(year);
        bill.setSequenceNumber(sequenceNumber);
        bill.setNumber(formatNumber(year, sequenceNumber));
        bill.addEvent(BillEvent.Type.CREATED, Instant.now(), "Bill of " + bill.getSupplier().getName() + " recorded.", null);
        return toDto(billRepository.save(bill), context(user), InvoiceService.today());
    }

    public BillDTO update(String userId, Long billId, BillRequest request) {
        User user = user(userId);
        Bill found = owned(userId, billId);
        synchronized (lockOf(billId)) {
            Bill bill = current(found);
            if (!open(bill)) {
                throw new ConflictException(bill.getStatus() == Bill.Status.PAID
                        ? "A paid bill can't be edited."
                        : "This bill is being paid, so it can't be edited.");
            }
            apply(bill, request, user);
            bill.addEvent(BillEvent.Type.UPDATED, Instant.now(), "Bill updated.", null);
            return toDto(billRepository.save(bill), context(user), InvoiceService.today());
        }
    }

    public void delete(String userId, Long billId) {
        Bill found = owned(userId, billId);
        synchronized (lockOf(billId)) {
            Bill bill = current(found);
            if (!open(bill)) {
                throw new ConflictException(bill.getStatus() == Bill.Status.PAID
                        ? "A paid bill can't be deleted."
                        : "This bill is being paid, so it can't be deleted.");
            }
            billRepository.delete(bill);
        }
    }

    // ---------- Payment by transfer ----------

    /**
     * Checks the name of each supplier with its bank (Verification of Payee) before its bills are paid by transfer.
     * A supplier with several bills is checked once.
     */
    public List<PayeeCheckDTO> checkPayees(String userId, BillPaymentRequest request) {
        user(userId);
        List<Long> billIds = billIds(request);
        String transferType = transferType(request);
        Map<Long, PayeeCheck> bySupplier = new HashMap<>();
        List<PayeeCheckDTO> results = new ArrayList<>();
        for (Long billId : billIds) {
            Bill found = owned(userId, billId);
            Supplier supplier = found.getSupplier();
            PayeeCheck check = bySupplier.computeIfAbsent(supplier.getId(), id -> verifyPayee(found, transferType));
            synchronized (lockOf(billId)) {
                Bill bill = current(found);
                if (recordPayeeCheck(bill, check)) {
                    billRepository.save(bill);
                }
            }
            results.add(new PayeeCheckDTO(found.getId(), found.getNumber(), supplier.getId(), supplier.getName(),
                    BankDetails.masked(supplier.getBankAccountFormat(), supplier.getIban(), supplier.getAccountNumber(),
                            supplier.getSortCode()),
                    check.result(), check.name(), check.description(), check.checkedAt()));
        }
        return results;
    }

    /**
     * The transfer speeds that can pay each bill: the routes Adyen offers from the business account to the bank account
     * of its supplier, within their amount limits. The routes to a supplier with several bills are calculated once.
     */
    public List<BillTransferRoutesDTO> transferRoutes(String userId, BillPaymentRequest request) throws IOException, ApiException {
        User user = user(userId);
        List<Long> billIds = billIds(request);
        String issue = transfersIssue(user);
        if (issue != null) {
            throw new BadRequestException(issue);
        }
        String balanceAccountId = bankAccounts.balanceAccountId(user);
        Map<Long, SupplierRoutes> bySupplier = new HashMap<>();
        List<BillTransferRoutesDTO> results = new ArrayList<>();
        for (Long billId : billIds) {
            Bill bill = owned(userId, billId);
            SupplierRoutes routes = bySupplier.computeIfAbsent(bill.getSupplier().getId(),
                    id -> supplierRoutes(balanceAccountId, bill));
            if (routes.error() != null) {
                results.add(new BillTransferRoutesDTO(billId, List.of(), routes.error()));
                continue;
            }
            List<BillTransferRoutesDTO.Speed> speeds = TRANSFER_TYPES.stream()
                    .map(type -> {
                        String reason = TransferRouteService.unavailableReason(routes.options(), type, bill.getTotal(),
                                bill.getCurrency());
                        return new BillTransferRoutesDTO.Speed(type, reason == null, reason);
                    })
                    .toList();
            results.add(new BillTransferRoutesDTO(billId, speeds, null));
        }
        return results;
    }

    private SupplierRoutes supplierRoutes(String balanceAccountId, Bill bill) {
        Supplier supplier = bill.getSupplier();
        if (!supplier.hasBankAccount()) {
            return new SupplierRoutes(List.of(), noBankDetails(supplier));
        }
        String bankCountry = BankDetails.country(supplier.getBankAccountFormat(), supplier.getIban());
        RecipientCountry recipientCountry = RecipientCountries.find(bill.getCurrency(), bankCountry).orElse(null);
        if (recipientCountry == null) {
            return new SupplierRoutes(List.of(), unreachableBank(bill.getCurrency(), bankCountry));
        }
        try {
            return new SupplierRoutes(transferRouteService.calculateRoutes(balanceAccountId, recipientCountry,
                    toSupplier(supplier, recipientCountry)), null);
        } catch (BadRequestException e) {
            return new SupplierRoutes(List.of(), e.getMessage());
        } catch (IOException | RuntimeException e) {
            log.warn("Transfer routes to supplier {} failed: {}", supplier.getId(), e.getMessage());
            return new SupplierRoutes(List.of(), "The transfer speeds to this supplier couldn't be checked. Try again.");
        }
    }

    /**
     * Creates one transfer per bill, with the number of the bill as its reference. They wait for one approval with SCA
     * on the Batch transfers page. A bill that can't be paid doesn't stop the others.
     */
    public BillPaymentResultDTO payByTransfer(String userId, BillPaymentRequest request) throws IOException, ApiException {
        User user = user(userId);
        List<Long> billIds = billIds(request);
        String transferType = transferType(request);
        String issue = transfersIssue(user);
        if (issue != null) {
            throw new BadRequestException(issue);
        }
        String balanceAccountId = bankAccounts.balanceAccountId(user);
        String paymentInstrumentId = bankAccounts.transferPi(user);
        List<BillPaymentResultDTO.Item> results = new ArrayList<>();
        for (Long billId : billIds) {
            Bill found = billRepository.findByIdAndUserId(billId, userId).orElse(null);
            if (found == null) {
                results.add(new BillPaymentResultDTO.Item(billId, null, null, 0, null, null, "Bill not found."));
                continue;
            }
            synchronized (lockOf(billId)) {
                Bill bill = current(found);
                String transferId = null;
                String error = null;
                try {
                    transferId = initiateTransfer(user, bill, transferType, balanceAccountId, paymentInstrumentId);
                } catch (BadRequestException | ConflictException e) {
                    error = e.getMessage();
                } catch (Exception e) {
                    log.warn("No transfer created for bill {}: {}", bill.getNumber(), e.getMessage());
                    String detail = adyenError(e);
                    error = detail != null ? "Transfer refused: " + detail
                            : "The transfer couldn't be created. Try again.";
                }
                results.add(new BillPaymentResultDTO.Item(bill.getId(), bill.getNumber(), bill.getSupplier().getName(),
                        bill.getTotal(), bill.getCurrency(), transferId, error));
            }
        }
        int created = (int) results.stream().filter(item -> item.transferId() != null).count();
        return new BillPaymentResultDTO(results, created, results.size() - created);
    }

    private String initiateTransfer(User user, Bill bill, String transferType, String balanceAccountId,
                                    String paymentInstrumentId) throws IOException {
        requirePayable(bill);
        Supplier supplier = bill.getSupplier();
        if (!supplier.hasBankAccount()) {
            throw new BadRequestException(noBankDetails(supplier));
        }
        String format = supplier.getBankAccountFormat();
        RecipientCountry recipientCountry = RecipientCountries.require(bill.getCurrency(),
                BankDetails.country(format, supplier.getIban()));
        TransferRequest transfer = toSupplier(supplier, recipientCountry);
        transfer.setUserId(user.getId());
        transfer.setAmount(bill.getTotal());
        transfer.setReference(bill.getNumber());
        transfer.setDescription(BankDetails.transferDescription(bill.getSupplierReference() != null
                ? "Invoice " + bill.getSupplierReference()
                : bill.getNumber(), format));
        transfer.setTransferType(transferType);
        transferRouteService.requireEligible(balanceAccountId, recipientCountry, transfer);
        Map<String, Object> created = transferService.initiateBatchTransfer(transfer, paymentInstrumentId,
                user.getAccountHolderId(), recipientCountry);

        String transferId = Objects.toString(created.get("id"), null);
        Instant now = Instant.now();
        clearPayment(bill);
        bill.setPaymentMethod(Bill.PaymentMethod.TRANSFER);
        bill.setTransferId(transferId);
        bill.setTransferStatus(Objects.toString(created.get("status"), null));
        bill.setStatus(Bill.Status.PENDING_APPROVAL);
        bill.setPaymentCheckedAt(now);
        bill.addEvent(BillEvent.Type.TRANSFER_CREATED, now, "Transfer of " + money(bill.getTotal(), bill.getCurrency())
                + " to " + BankDetails.masked(format, supplier.getIban(), supplier.getAccountNumber(), supplier.getSortCode())
                + " created. It waits for your approval.", transferId);
        billRepository.save(bill);
        return transferId;
    }

    /** Cancels the transfer of a bill that still waits for its approval: the bill is to pay again. */
    public BillDTO cancelTransfer(String userId, Long billId) {
        User user = user(userId);
        Bill found = owned(userId, billId);
        synchronized (lockOf(billId)) {
            Bill bill = current(found);
            if (bill.getPaymentMethod() != Bill.PaymentMethod.TRANSFER || bill.getStatus() != Bill.Status.PENDING_APPROVAL) {
                throw new ConflictException("Only a transfer that waits for its approval can be cancelled.");
            }
            String transferId = bill.getTransferId();
            boolean cancelled;
            try {
                cancelled = transferService.cancelTransfers(user.getAccountHolderId(), List.of(transferId))
                        .transferIds().contains(transferId);
            } catch (BadRequestException e) {
                cancelled = false;
            }
            if (!cancelled) {
                // Approved, cleared on the Batch transfers page or expired in the meantime: the bill follows its transfer.
                checkTransfer(bill, Instant.now());
                Bill saved = billRepository.save(bill);
                if (saved.getStatus() != Bill.Status.TO_PAY) {
                    throw new ConflictException("This transfer no longer waits for its approval.");
                }
                return toDto(saved, context(user), InvoiceService.today());
            }
            Instant now = Instant.now();
            clearPayment(bill);
            bill.setStatus(Bill.Status.TO_PAY);
            bill.addEvent(BillEvent.Type.TRANSFER_FAILED, now, "Transfer cancelled before its approval. The bill is to pay again.",
                    transferId);
            return toDto(billRepository.save(bill), context(user), InvoiceService.today());
        }
    }

    // ---------- Payment by card ----------

    /**
     * Issues a virtual card that can make one payment, up to the total of the bill. The supplier charges it like any
     * card; the bill is paid once the payment is captured.
     */
    public BillDTO payByCard(String userId, Long billId, BillCardRequest request) throws IOException, ApiException {
        User user = user(userId);
        Bill found = owned(userId, billId);
        synchronized (lockOf(billId)) {
            Bill bill = current(found);
            requirePayable(bill);
            String issue = cardsIssue(user);
            if (issue != null) {
                throw new BadRequestException(issue);
            }
            String currency = bill.getCurrency();
            String brand = request != null && request.brand() != null && !request.brand().isBlank()
                    ? request.brand().trim().toLowerCase(Locale.ROOT)
                    : cardBrands(currency).stream().findFirst().orElse(null);
            CardRangeCatalog.CardRange range = brand == null ? null
                    : cardRangeCatalog.find(brand, currency, user.getCountryCode()).orElse(null);
            if (range == null) {
                throw new BadRequestException(networkName(brand) + " cards aren't configured for " + currency + " balance accounts.");
            }
            String balanceAccountId = cardBalanceAccountId(user);
            String cardCurrency = issuingService.getBalanceAccountCurrency(balanceAccountId);
            if (!currency.equals(cardCurrency)) {
                throw new BadRequestException("A card spends in the currency of its balance account (" + cardCurrency
                        + "), and this bill is in " + currency + ".");
            }

            String paymentInstrumentId;
            try {
                paymentInstrumentId = issuingService.createVirtualCard(range, balanceAccountId, cardholderName(user),
                        user.getEmail(), null);
            } catch (ApiException e) {
                if (e.getResponseBody() == null || !e.getResponseBody().contains("No card range available")) {
                    throw e;
                }
                log.warn("Adyen has no card range for {} issued in {} in {}: check adyen.issuing.card-ranges",
                        range.brandVariant(), range.countryCode(), currency);
                throw new BadRequestException(networkName(brand) + " cards aren't configured for " + currency + " balance accounts.");
            }
            try {
                issuingService.createTransactionRule(paymentInstrumentId, "maxTransactions", 1L, currency);
                issuingService.createTransactionRule(paymentInstrumentId, "maxTotalAmount", bill.getTotal(), currency);
            } catch (IOException | ApiException | RuntimeException e) {
                // Without its limits, the card could be charged any amount, any number of times.
                closeQuietly(paymentInstrumentId);
                throw e;
            }
            Card card = new Card();
            card.setPaymentInstrumentId(paymentInstrumentId);
            card.setUser(user);
            cardRepository.save(card);

            CardResponse details = null;
            try {
                details = issuingService.getCardDetails(paymentInstrumentId);
            } catch (Exception e) {
                log.warn("Couldn't read the card of bill {}: {}", bill.getNumber(), e.getMessage());
            }
            Instant now = Instant.now();
            clearPayment(bill);
            bill.setPaymentMethod(Bill.PaymentMethod.CARD);
            bill.setPaymentInstrumentId(paymentInstrumentId);
            bill.setCardBrand(details != null && details.getBrand() != null ? details.getBrand() : range.brand());
            bill.setCardLastFour(details != null ? details.getLastFour() : null);
            bill.setCardStatus(CARD_ACTIVE);
            bill.setStatus(Bill.Status.PROCESSING);
            bill.setPaymentCheckedAt(now);
            bill.addEvent(BillEvent.Type.CARD_ISSUED, now, "Single-use " + networkName(bill.getCardBrand()) + " card"
                    + (bill.getCardLastFour() != null ? " \u2022\u2022\u2022\u2022 " + bill.getCardLastFour() : "")
                    + " issued for one payment of up to " + money(bill.getTotal(), currency) + ".", null);
            return toDto(billRepository.save(bill), context(user), InvoiceService.today());
        }
    }

    /** Closes the single-use card of a bill before the supplier used it: the bill is to pay again. */
    public BillDTO cancelCard(String userId, Long billId) throws IOException, ApiException {
        User user = user(userId);
        Bill found = owned(userId, billId);
        synchronized (lockOf(billId)) {
            Bill bill = current(found);
            if (bill.getPaymentMethod() != Bill.PaymentMethod.CARD || bill.getStatus() != Bill.Status.PROCESSING) {
                throw new ConflictException("Only the card of a bill that isn't paid yet can be cancelled.");
            }
            try {
                checkCard(user, bill);
            } catch (Exception e) {
                log.warn("Couldn't check the card payments of bill {}: {}", bill.getNumber(), e.getMessage());
            }
            if (bill.getStatus() != Bill.Status.PROCESSING || hasEvent(bill, BillEvent.Type.CARD_CHARGED, null)) {
                billRepository.save(bill);
                throw new ConflictException("The supplier already charged this card, so it can't be cancelled.");
            }
            issuingService.updateCardStatus(bill.getPaymentInstrumentId(), CARD_CLOSED);
            Instant now = Instant.now();
            clearPayment(bill);
            bill.setStatus(Bill.Status.TO_PAY);
            bill.addEvent(BillEvent.Type.CARD_CLOSED, now, "Single-use card closed before it was used. The bill is to pay again.",
                    null);
            return toDto(billRepository.save(bill), context(user), InvoiceService.today());
        }
    }

    // ---------- Webhooks ----------

    /** Applies a balancePlatform.transfer.created or .updated webhook to the bill its transfer, or its card, pays. */
    public void applyTransferWebhook(JsonNode data) {
        String transferId = AdyenNotifications.text(data, "id");
        if (transferId == null) {
            return;
        }
        String category = AdyenNotifications.text(data, "category");
        if ("bank".equals(category)) {
            billRepository.findFirstByTransferId(transferId).ifPresent(found -> {
                synchronized (lockOf(found.getId())) {
                    Bill bill = current(found);
                    if (applyBankTransfer(bill, transferId, AdyenNotifications.text(data, "status"),
                            AdyenNotifications.text(data, "reason"), eventTime(data))) {
                        billRepository.save(bill);
                        log.info("Bill {} updated from the transfer webhook of {}", bill.getNumber(), transferId);
                    }
                }
            });
        } else if ("issuedCard".equals(category)) {
            String paymentInstrumentId = AdyenNotifications.text(data.path("paymentInstrument"), "id");
            if (paymentInstrumentId == null) {
                return;
            }
            billRepository.findFirstByPaymentInstrumentId(paymentInstrumentId).ifPresent(found -> {
                synchronized (lockOf(found.getId())) {
                    Bill bill = current(found);
                    if (applyCardPayment(bill, cardPayment(data))) {
                        billRepository.save(bill);
                        log.info("Bill {} updated from the card payment webhook of {}", bill.getNumber(), transferId);
                    }
                }
            });
        }
    }

    /**
     * Settles the payments in progress that no webhook settled: with the webhooks another backend sharing the database
     * stored, else by asking Adyen. Each payment is checked once per interval at most. Returns true when a bill changed.
     */
    private boolean checkPayments(User user, List<Bill> bills, Duration interval, int max, Instant now) {
        List<Bill> due = bills.stream()
                .filter(bill -> paymentCheckDue(bill, interval, now))
                .sorted(Comparator.comparing(Bill::getPaymentCheckedAt, Comparator.nullsFirst(Comparator.naturalOrder())))
                .limit(max)
                .toList();
        for (Bill found : due) {
            synchronized (lockOf(found.getId())) {
                Bill bill = current(found);
                if (!paymentCheckDue(bill, interval, now)) {
                    continue; // settled, or just checked, by another request
                }
                try {
                    if (bill.getPaymentMethod() == Bill.PaymentMethod.TRANSFER) {
                        checkTransfer(bill, now);
                    } else {
                        checkCard(user, bill);
                    }
                } catch (Exception e) {
                    log.warn("Couldn't check the payment of bill {}: {}", bill.getNumber(), e.getMessage());
                }
                bill.setPaymentCheckedAt(now);
                billRepository.save(bill);
            }
        }
        return !due.isEmpty();
    }

    /** A payment in progress, or a paid bill whose card couldn't be closed yet. */
    private static boolean paymentCheckDue(Bill bill, Duration interval, Instant now) {
        boolean inProgress = (bill.getStatus() == Bill.Status.PENDING_APPROVAL || bill.getStatus() == Bill.Status.PROCESSING)
                && bill.getPaymentMethod() != null;
        boolean cardToClose = bill.getStatus() == Bill.Status.PAID && bill.getPaymentMethod() == Bill.PaymentMethod.CARD
                && CARD_ACTIVE.equals(bill.getCardStatus());
        return (inProgress || cardToClose)
                && (bill.getPaymentCheckedAt() == null || !bill.getPaymentCheckedAt().plus(interval).isAfter(now));
    }

    private void checkTransfer(Bill bill, Instant now) {
        String transferId = bill.getTransferId();
        if (transferId == null) {
            return;
        }
        applyStoredWebhooks(bill, transferId);
        if (bill.getStatus() != Bill.Status.PENDING_APPROVAL && bill.getStatus() != Bill.Status.PROCESSING) {
            return;
        }
        List<Map<String, Object>> details = transferService.getTransferDetails(List.of(transferId));
        if (!details.isEmpty()) {
            Map<String, Object> detail = details.get(0);
            applyBankTransfer(bill, transferId, value(detail.get("status")), value(detail.get("reason")), now);
        }
    }

    private void applyStoredWebhooks(Bill bill, String transferId) {
        try {
            for (WebhookEvent event : webhookEventRepository.findByResourceIdInOrderByReceivedAtAsc(List.of(transferId))) {
                if (event.getEventType() == null || !event.getEventType().startsWith(TRANSFER_WEBHOOK)) {
                    continue;
                }
                JsonNode data = objectMapper.readTree(event.getRawJson()).path("data");
                if (transferId.equals(AdyenNotifications.text(data, "id"))) {
                    applyBankTransfer(bill, transferId, AdyenNotifications.text(data, "status"),
                            AdyenNotifications.text(data, "reason"), eventTime(data));
                }
            }
        } catch (Exception e) {
            log.warn("Couldn't read the stored webhooks of bill {}: {}", bill.getNumber(), e.getMessage());
        }
    }

    /** The payments the supplier made with the card, oldest first; closes the card of a paid bill. */
    private void checkCard(User user, Bill bill) {
        if (bill.getStatus() == Bill.Status.PAID) {
            closeCard(bill, Instant.now());
            return;
        }
        if (user.getAccountHolderId() == null || bill.getPaymentInstrumentId() == null) {
            return;
        }
        List<CardTransferDTO> payments = new ArrayList<>(
                cardTransferService.getCardTransfers(user.getAccountHolderId(), bill.getPaymentInstrumentId()));
        Collections.reverse(payments);
        for (CardTransferDTO payment : payments) {
            applyCardPayment(bill, cardPayment(payment));
        }
    }

    /** Returns true when the bill changed. A paid bill only changes when its transfer is returned. */
    private boolean applyBankTransfer(Bill bill, String transferId, String status, String reason, Instant at) {
        if (bill.getPaymentMethod() != Bill.PaymentMethod.TRANSFER || transferId == null
                || !transferId.equals(bill.getTransferId())) {
            return false;
        }
        TransferStatuses.Outcome outcome = TransferStatuses.ofBankTransfer(status, reason);
        if (outcome == null) {
            return false;
        }
        Bill.Status current = bill.getStatus();
        boolean inProgress = current == Bill.Status.PENDING_APPROVAL || current == Bill.Status.PROCESSING;
        switch (outcome) {
            case PENDING_APPROVAL -> {
                if (current != Bill.Status.PENDING_APPROVAL || Objects.equals(status, bill.getTransferStatus())) {
                    return false;
                }
                bill.setTransferStatus(status);
                return true;
            }
            case PROCESSING -> {
                if (current == Bill.Status.PENDING_APPROVAL) {
                    bill.setStatus(Bill.Status.PROCESSING);
                    bill.setTransferStatus(status);
                    bill.addEvent(BillEvent.Type.TRANSFER_APPROVED, at,
                            "Transfer approved and sent to the supplier's bank.", transferId);
                    return true;
                }
                if (current != Bill.Status.PROCESSING || Objects.equals(status, bill.getTransferStatus())) {
                    return false;
                }
                bill.setTransferStatus(status);
                return true;
            }
            case PAID -> {
                if (!inProgress) {
                    return false;
                }
                if (current == Bill.Status.PENDING_APPROVAL) {
                    bill.addEvent(BillEvent.Type.TRANSFER_APPROVED, at, "Transfer approved.", transferId);
                }
                bill.setTransferStatus(status);
                markPaid(bill, at, "Paid: transfer of " + money(bill.getTotal(), bill.getCurrency()) + " booked.", transferId);
                return true;
            }
            case FAILED -> {
                boolean returned = "returned".equals(status);
                if (!inProgress && !(current == Bill.Status.PAID && returned)) {
                    return false;
                }
                bill.setTransferStatus(status);
                if (current == Bill.Status.PENDING_APPROVAL && cancelled(status, reason)) {
                    bill.setStatus(Bill.Status.TO_PAY);
                    bill.setFailureReason(null);
                    bill.addEvent(BillEvent.Type.TRANSFER_FAILED, at,
                            "Transfer cancelled before its approval. The bill is to pay again.", transferId);
                } else {
                    String failure = transferFailure(status, reason);
                    bill.setStatus(Bill.Status.FAILED);
                    bill.setPaidAt(null);
                    bill.setFailureReason(failure);
                    bill.addEvent(BillEvent.Type.TRANSFER_FAILED, at, failure, transferId);
                }
                return true;
            }
        }
        return false;
    }

    /** Returns true when the bill changed. */
    private boolean applyCardPayment(Bill bill, CardPayment payment) {
        if (bill.getPaymentMethod() != Bill.PaymentMethod.CARD || payment.transferId() == null
                || "incoming".equals(payment.direction())) {
            return false;
        }
        TransferStatuses.Outcome outcome = TransferStatuses.ofCardPayment(payment.status());
        if (outcome == null) {
            return false;
        }
        String amount = money(payment.amount(), payment.currency() != null ? payment.currency() : bill.getCurrency());
        String merchant = payment.merchant() != null ? payment.merchant() : "The supplier";
        switch (outcome) {
            case FAILED -> {
                if (bill.getStatus() != Bill.Status.PROCESSING
                        || hasEvent(bill, BillEvent.Type.CARD_REFUSED, payment.transferId())) {
                    return false;
                }
                String reason = cardRefusal(payment.reason());
                bill.addEvent(BillEvent.Type.CARD_REFUSED, payment.at(), "Card payment of " + amount
                        + (payment.merchant() != null ? " by " + payment.merchant() : "") + " " + words(payment.status())
                        + (reason != null ? ": " + reason : "") + ".", payment.transferId());
                return true;
            }
            case PROCESSING, PENDING_APPROVAL -> {
                if (bill.getStatus() != Bill.Status.PROCESSING
                        || hasEvent(bill, BillEvent.Type.CARD_CHARGED, payment.transferId())) {
                    return false;
                }
                bill.setTransferId(payment.transferId());
                bill.setTransferStatus(payment.status());
                bill.addEvent(BillEvent.Type.CARD_CHARGED, payment.at(), merchant + " charged " + amount
                        + " to the card. Paid once captured.", payment.transferId());
                return true;
            }
            case PAID -> {
                if (bill.getStatus() != Bill.Status.PROCESSING) {
                    return false;
                }
                bill.setTransferId(payment.transferId());
                bill.setTransferStatus(payment.status());
                markPaid(bill, payment.at(), "Paid with the single-use card: " + merchant + " captured " + amount + ".",
                        payment.transferId());
                closeCard(bill, payment.at());
                return true;
            }
        }
        return false;
    }

    private static void markPaid(Bill bill, Instant paidAt, String detail, String transferId) {
        bill.setStatus(Bill.Status.PAID);
        bill.setPaidAt(paidAt);
        bill.setFailureReason(null);
        bill.addEvent(BillEvent.Type.PAID, paidAt, detail, transferId);
    }

    /** Closes the card of a paid bill, so it can't be charged again. Returns true when it was closed. */
    private boolean closeCard(Bill bill, Instant at) {
        if (bill.getPaymentInstrumentId() == null || !CARD_ACTIVE.equals(bill.getCardStatus())) {
            return false;
        }
        try {
            issuingService.updateCardStatus(bill.getPaymentInstrumentId(), CARD_CLOSED);
        } catch (Exception e) {
            log.warn("Couldn't close the single-use card of bill {}: {}", bill.getNumber(), e.getMessage());
            return false;
        }
        bill.setCardStatus(CARD_CLOSED);
        bill.addEvent(BillEvent.Type.CARD_CLOSED, at, "Single-use card closed: it can't be charged again.", null);
        return true;
    }

    private void closeQuietly(String paymentInstrumentId) {
        try {
            issuingService.updateCardStatus(paymentInstrumentId, CARD_CLOSED);
        } catch (Exception e) {
            log.error("Card {} was issued without its limits and couldn't be closed: {}", paymentInstrumentId, e.getMessage());
        }
    }

    private static CardPayment cardPayment(JsonNode data) {
        JsonNode merchant = data.path("counterparty").path("merchant");
        String merchantName = AdyenNotifications.text(merchant, "name");
        if (merchantName == null) {
            merchantName = AdyenNotifications.text(merchant.path("nameLocation"), "name");
        }
        return new CardPayment(AdyenNotifications.text(data, "id"), AdyenNotifications.text(data, "direction"),
                AdyenNotifications.text(data, "status"), AdyenNotifications.text(data, "reason"),
                data.path("amount").path("value").asLong(0), AdyenNotifications.text(data.path("amount"), "currency"),
                merchantName, eventTime(data));
    }

    private static CardPayment cardPayment(CardTransferDTO payment) {
        Instant at = instant(payment.getUpdatedAt());
        if (at == null) {
            at = instant(payment.getCreatedAt());
        }
        return new CardPayment(payment.getId(), payment.getDirection(), payment.getStatus(), payment.getReason(),
                payment.getAmount(), payment.getCurrency(), blankToNull(payment.getMerchantName()),
                at != null ? at : Instant.now());
    }

    /** When the transfer was last booked, else now. */
    private static Instant eventTime(JsonNode data) {
        Instant latest = null;
        for (JsonNode event : data.path("events")) {
            Instant at = instant(AdyenNotifications.text(event, "bookingDate"));
            if (at != null && (latest == null || at.isAfter(latest))) {
                latest = at;
            }
        }
        return latest != null ? latest : Instant.now();
    }

    // ---------- Verification of Payee ----------

    private PayeeCheck verifyPayee(Bill bill, String transferType) {
        Instant now = Instant.now();
        Supplier supplier = bill.getSupplier();
        if (!supplier.hasBankAccount()) {
            return new PayeeCheck(CHECK_ERROR, null, "The supplier has no bank details: add them to pay it by transfer.", now);
        }
        String format = supplier.getBankAccountFormat();
        String bankCountry = BankDetails.country(format, supplier.getIban());
        RecipientCountry recipientCountry = RecipientCountries.find(bill.getCurrency(), bankCountry).orElse(null);
        if (recipientCountry == null) {
            return new PayeeCheck(CHECK_ERROR, null, unreachableBank(bill.getCurrency(), bankCountry), now);
        }
        if (!recipientCountry.isPayeeVerification()) {
            return new PayeeCheck(NOT_AVAILABLE, null, describePayeeCheck(NOT_AVAILABLE, null, null, bankCountry), now);
        }
        VerifyCounterpartyNameRequest request = new VerifyCounterpartyNameRequest();
        request.setAccountHolderName(supplier.getName());
        request.setAccountType(format);
        request.setIban(supplier.getIban());
        request.setAccountNumber(supplier.getAccountNumber());
        request.setSortCode(supplier.getSortCode());
        request.setCounterpartyCountry(bankCountry);
        request.setTransferType(transferType);
        // In TEST, Adyen answers with the result the reference names; any other reference gets a match.
        request.setReference(supplier.getVopScenario() != null ? supplier.getVopScenario() : bill.getNumber());
        try {
            CounterpartyVerificationResponse response = bankValidationService.verifyCounterpartyName(request);
            String result = response != null ? blankToNull(response.getResponse()) : null;
            if (result == null) {
                return new PayeeCheck(CHECK_ERROR, null, "The name check returned no result. Try again.", now);
            }
            String name = blankToNull(response.getName());
            if (name != null && name.length() > MAX_CHECKED_NAME) {
                name = name.substring(0, MAX_CHECKED_NAME).trim();
            }
            return new PayeeCheck(result, name, describePayeeCheck(result, name, response.getResponseDescription(), bankCountry),
                    now);
        } catch (RuntimeException e) {
            log.warn("Verification of Payee of supplier {} failed: {}", supplier.getId(), e.getMessage());
            String detail = adyenError(e);
            return new PayeeCheck(CHECK_ERROR, null, detail != null
                    ? "The name couldn't be checked: " + detail
                    : "The name couldn't be checked with the supplier's bank. Try again.", now);
        }
    }

    /** Saves the result on the bill; an error isn't a result. Returns true when the bill changed. */
    private static boolean recordPayeeCheck(Bill bill, PayeeCheck check) {
        if (CHECK_ERROR.equals(check.result())) {
            return false;
        }
        boolean known = check.result().equals(bill.getPayeeCheckResult()) && Objects.equals(check.name(), bill.getPayeeCheckName());
        bill.setPayeeCheckResult(check.result());
        bill.setPayeeCheckName(check.name());
        bill.setPayeeCheckedAt(check.checkedAt());
        if (!known) {
            bill.addEvent(BillEvent.Type.PAYEE_CHECKED, check.checkedAt(), "Verification of Payee. " + check.description(), null);
        }
        return true;
    }

    private static String describePayeeCheck(String result, String name, String adyenDescription, String bankCountry) {
        return switch (result) {
            case "nameMatch" -> "The name matches the account holder.";
            case "partialNameMatch" -> "The bank has a similar name" + (name != null ? ": " + name : "") + ".";
            case "noNameMatch" -> "The name doesn't match the account holder. Paying may send the money to the wrong account.";
            case "nameMatchNotSupported" -> "The supplier's bank doesn't check names.";
            case NOT_AVAILABLE -> "Banks in " + countryName(bankCountry) + " don't check payee names.";
            default -> adyenDescription != null && !adyenDescription.isBlank()
                    ? adyenDescription
                    : "The supplier's bank answered: " + words(result) + ".";
        };
    }

    // ---------- Validation and mapping ----------

    private void apply(Bill bill, BillRequest request, User user) {
        if (request == null) {
            throw new BadRequestException("The bill is missing.");
        }
        Supplier supplier = request.supplierId() == null ? null
                : supplierRepository.findByIdAndUserId(request.supplierId(), user.getId()).orElse(null);
        if (supplier == null) {
            throw new BadRequestException("Choose a supplier.");
        }
        LocalDate issueDate = request.issueDate() != null ? request.issueDate() : InvoiceService.today();
        LocalDate dueDate = request.dueDate() != null ? request.dueDate() : issueDate.plusDays(PAYMENT_TERMS_DAYS);
        if (dueDate.isBefore(issueDate)) {
            throw new BadRequestException("The due date can't be before the issue date.");
        }
        String taxLabel = VatRates.taxLabel(user.getCountryCode());
        Long subtotal = request.subtotal();
        if (subtotal == null || subtotal <= 0 || subtotal > MAX_AMOUNT) {
            throw new BadRequestException("Enter the amount excluding " + taxLabel + ", greater than 0.");
        }
        BigDecimal vatRate = request.vatRate() != null ? request.vatRate() : VatRates.forCountry(user.getCountryCode()).get(0);
        if (vatRate.signum() < 0 || vatRate.compareTo(HUNDRED) > 0) {
            throw new BadRequestException("The " + taxLabel + " rate must be between 0 and 100%.");
        }
        if (vatRate.stripTrailingZeros().scale() > 2) {
            throw new BadRequestException("The " + taxLabel + " rate can have up to 2 decimals.");
        }
        String category = SupplierService.text(request.category(), 10, "The category");
        if (category == null) {
            category = supplier.getDefaultCategory() != null ? supplier.getDefaultCategory() : ExpenseCategories.OTHER.code();
        }
        if (ExpenseCategories.find(category).isEmpty()) {
            throw new BadRequestException("Choose a category from the list.");
        }
        String supplierReference = SupplierService.text(request.supplierReference(), MAX_SUPPLIER_REFERENCE,
                "The supplier's invoice number");
        String description = SupplierService.text(request.description(), MAX_DESCRIPTION, "The description");
        InvoiceMath.Amounts amounts;
        try {
            amounts = InvoiceMath.line(1, subtotal, vatRate);
        } catch (ArithmeticException e) {
            throw new BadRequestException("The amount is too large.");
        }
        if (bill.getSupplier() != null && !bill.getSupplier().getId().equals(supplier.getId())) {
            bill.setPayeeCheckResult(null);
            bill.setPayeeCheckName(null);
            bill.setPayeeCheckedAt(null);
        }
        bill.setSupplier(supplier);
        bill.setSupplierReference(supplierReference);
        bill.setIssueDate(issueDate);
        bill.setDueDate(dueDate);
        bill.setDescription(description);
        bill.setCategory(category);
        bill.setVatRate(vatRate.setScale(2));
        bill.setSubtotal(amounts.net());
        bill.setTaxTotal(amounts.tax());
        bill.setTotal(amounts.gross());
    }

    private BillDTO toDto(Bill bill, Context context, LocalDate today) {
        Bill.Status status = bill.getStatus();
        boolean overdue = status == Bill.Status.TO_PAY && bill.getDueDate().isBefore(today);
        Supplier supplier = bill.getSupplier();
        String format = supplier.getBankAccountFormat();
        BillDTO.SupplierRef supplierRef = new BillDTO.SupplierRef(supplier.getId(), supplier.getName(), supplier.getEmail(),
                supplier.getCountry(),
                BankDetails.masked(format, supplier.getIban(), supplier.getAccountNumber(), supplier.getSortCode()),
                BankDetails.country(format, supplier.getIban()));
        BillDTO.Card card = bill.getPaymentInstrumentId() == null ? null
                : new BillDTO.Card(bill.getPaymentInstrumentId(), bill.getCardBrand(), bill.getCardLastFour(), bill.getCardStatus());
        BillDTO.PayeeCheck payeeCheck = bill.getPayeeCheckResult() == null ? null
                : new BillDTO.PayeeCheck(bill.getPayeeCheckResult(), bill.getPayeeCheckName(), bill.getPayeeCheckedAt());
        List<BillDTO.Event> events = bill.getEvents().stream()
                .sorted(Comparator.comparing(BillEvent::getOccurredAt))
                .map(event -> new BillDTO.Event(event.getType().name(), event.getOccurredAt(), event.getDetail(),
                        event.getTransferId()))
                .toList();
        boolean open = open(bill);
        return new BillDTO(
                bill.getId(),
                bill.getNumber(),
                bill.getSupplierReference(),
                overdue ? "OVERDUE" : status.name(),
                overdue ? ChronoUnit.DAYS.between(bill.getDueDate(), today) : null,
                supplierRef,
                bill.getIssueDate(),
                bill.getDueDate(),
                bill.getCurrency(),
                bill.getSubtotal(),
                bill.getTaxTotal(),
                bill.getTotal(),
                bill.getVatRate(),
                bill.getCategory(),
                ExpenseCategories.of(bill.getCategory()).name(),
                bill.getDescription(),
                bill.getPaymentMethod() != null ? bill.getPaymentMethod().name() : null,
                bill.getTransferId(),
                bill.getTransferStatus(),
                card,
                payeeCheck,
                bill.getFailureReason(),
                bill.getCreatedAt(),
                bill.getPaidAt(),
                events,
                open,
                open,
                open && context.transfersIssue() == null && supplier.hasBankAccount(),
                open && context.cardsIssue() == null,
                status == Bill.Status.PROCESSING && bill.getPaymentMethod() == Bill.PaymentMethod.CARD
                        && !hasEvent(bill, BillEvent.Type.CARD_CHARGED, null));
    }

    private Context context(User user) {
        return new Context(transfersIssue(user), cardsIssue(user));
    }

    /** Why the user can't pay bills by transfer yet, null when they can. */
    String transfersIssue(User user) {
        String currency = InvoiceService.currency(user);
        if (!bankAccounts.hasBankAccount(user)) {
            return "Open the business account first: bills are paid by transfer from it.";
        }
        if (user.getAccountHolderId() == null) {
            return "The account has no account holder yet.";
        }
        if (RecipientCountries.forAccountCurrency(currency).isEmpty()) {
            return "Transfers aren't available from a " + currency + " account.";
        }
        return null;
    }

    /** Why the user can't pay bills with a single-use card yet, null when they can. */
    String cardsIssue(User user) {
        String currency = InvoiceService.currency(user);
        if (!Boolean.TRUE.equals(user.getIssuing())) {
            return "Issuing isn't active on this account.";
        }
        if (!bankAccounts.hasBankAccount(user) && blankToNull(user.getBalanceAccountId()) == null) {
            return "The account has no balance account to issue the card on yet.";
        }
        if (cardBrands(currency).isEmpty()) {
            return "No card network is configured to issue " + currency + " cards.";
        }
        return null;
    }

    /** The networks single-use cards can be issued on in this currency, the default one first. */
    private List<String> cardBrands(String currency) {
        return cardRangeCatalog.networks().stream()
                .filter(network -> network.currencies() == null || network.currencies().contains(currency))
                .map(CardNetworkOption::brand)
                .toList();
    }

    /** The card spends from the business account, which pays the suppliers; without one, from the user's balance account. */
    private String cardBalanceAccountId(User user) throws IOException, ApiException {
        if (bankAccounts.hasBankAccount(user)) {
            String balanceAccountId = bankAccounts.balanceAccountId(user);
            if (balanceAccountId != null) {
                return balanceAccountId;
            }
        }
        String balanceAccountId = blankToNull(user.getBalanceAccountId());
        if (balanceAccountId == null) {
            throw new BadRequestException("The account has no balance account to issue the card on yet.");
        }
        return balanceAccountId;
    }

    private static String cardholderName(User user) {
        String name = blankToNull(user.getLegalEntityName());
        if (name == null) {
            name = (Objects.toString(user.getFirstName(), "") + " " + Objects.toString(user.getLastName(), "")).trim();
        }
        if (name.isEmpty()) {
            name = "Accounts payable";
        }
        return name.length() > MAX_CARDHOLDER_NAME ? name.substring(0, MAX_CARDHOLDER_NAME).trim() : name;
    }

    private static void requirePayable(Bill bill) {
        switch (bill.getStatus()) {
            case PAID -> throw new ConflictException(bill.getNumber() + " is already paid.");
            case PENDING_APPROVAL -> throw new ConflictException("The transfer of " + bill.getNumber() + " already waits for approval.");
            case PROCESSING -> throw new ConflictException("A payment of " + bill.getNumber() + " is in progress.");
            case TO_PAY, FAILED -> {
            }
        }
    }

    /** The bank account of the supplier, as transfers and their routes take it. */
    private static TransferRequest toSupplier(Supplier supplier, RecipientCountry recipientCountry) {
        TransferRequest transfer = new TransferRequest();
        transfer.setCounterpartyCountry(recipientCountry.getCountryCode());
        transfer.setCounterpartyName(supplier.getName());
        transfer.setIban(supplier.getIban());
        transfer.setAccountNumber(supplier.getAccountNumber());
        transfer.setSortCode(supplier.getSortCode());
        transfer.setRoutingNumber(supplier.getRoutingNumber());
        return transfer;
    }

    private static String noBankDetails(Supplier supplier) {
        return "Add the bank details of " + supplier.getName() + " to pay this bill by transfer.";
    }

    private static String unreachableBank(String currency, String bankCountry) {
        return "Transfers from a " + currency + " account can't go to a bank in " + countryName(bankCountry) + ".";
    }

    /** To pay: no payment in progress and not paid. */
    private static boolean open(Bill bill) {
        return bill.getStatus() == Bill.Status.TO_PAY || bill.getStatus() == Bill.Status.FAILED;
    }

    /** Forgets the previous payment of the bill; its events keep its history. */
    private static void clearPayment(Bill bill) {
        bill.setPaymentMethod(null);
        bill.setTransferId(null);
        bill.setTransferStatus(null);
        bill.setPaymentInstrumentId(null);
        bill.setCardBrand(null);
        bill.setCardLastFour(null);
        bill.setCardStatus(null);
        bill.setFailureReason(null);
    }

    /** @param transferId null for an event of any transfer */
    private static boolean hasEvent(Bill bill, BillEvent.Type type, String transferId) {
        return bill.getEvents().stream().anyMatch(event -> event.getType() == type
                && (transferId == null || transferId.equals(event.getTransferId())));
    }

    private static List<Long> billIds(BillPaymentRequest request) {
        List<Long> billIds = request != null && request.billIds() != null
                ? request.billIds().stream().filter(Objects::nonNull).distinct().toList()
                : List.of();
        if (billIds.isEmpty()) {
            throw new BadRequestException("Select at least one bill.");
        }
        if (billIds.size() > MAX_BATCH) {
            throw new BadRequestException("Pay up to " + MAX_BATCH + " bills at once.");
        }
        return billIds;
    }

    private static String transferType(BillPaymentRequest request) {
        String type = request != null ? blankToNull(request.transferType()) : null;
        if (type == null) {
            return TRANSFER_TYPES.get(0);
        }
        if (!TRANSFER_TYPES.contains(type)) {
            throw new BadRequestException("Choose a regular, fast or instant transfer.");
        }
        return type;
    }

    private static boolean cancelled(String status, String reason) {
        return "cancelled".equals(status) || "cancelled".equals(reason);
    }

    private static String transferFailure(String status, String reason) {
        if ("approvalExpired".equals(reason)) {
            return "The transfer wasn't approved within 30 days, so it expired.";
        }
        if (cancelled(status, reason)) {
            return "The transfer was cancelled.";
        }
        String why = reason != null && !GENERIC_REASONS.contains(reason) ? ": " + words(reason) : "";
        if ("returned".equals(status)) {
            return "The supplier's bank returned the transfer" + why + ".";
        }
        return "The transfer " + (status != null ? words(status) : "failed") + why + ".";
    }

    private static String cardRefusal(String reason) {
        if (reason == null || GENERIC_REASONS.contains(reason)) {
            return null;
        }
        return switch (reason) {
            case "declinedByTransactionRule" -> "it exceeds the limits of the single-use card";
            case "notEnoughBalance" -> "the balance account doesn't have enough funds";
            default -> words(reason);
        };
    }

    /** The error Adyen returned, null for another failure. */
    static String adyenError(Exception e) {
        if (e instanceof HttpStatusCodeException http) {
            return GlobalExceptionHandler.messageFromBody(http.getResponseBodyAsString());
        }
        if (e instanceof ApiException api) {
            String message = GlobalExceptionHandler.messageFromBody(api.getResponseBody());
            return message != null || api.getError() == null ? message : api.getError().getMessage();
        }
        return null;
    }

    private int nextSequenceNumber(String userId, int year) {
        Integer last = billRepository.maxSequenceNumber(userId, year);
        return (last != null ? last : 0) + 1;
    }

    private static String formatNumber(int year, int sequenceNumber) {
        return String.format(Locale.ROOT, "BILL-%d-%04d", year, sequenceNumber);
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private Bill owned(String userId, Long billId) {
        return billRepository.findByIdAndUserId(billId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Bill not found"));
    }

    private Object lockOf(Long billId) {
        return billLocks[Math.floorMod(billId.hashCode(), billLocks.length)];
    }

    /**
     * The bill as stored now, to change under its lock. The copy the request read before may be stale: Open Session
     * in View keeps it for the whole request, even after another thread changed the bill.
     */
    private Bill current(Bill bill) {
        entityManager.detach(bill);
        return billRepository.findById(bill.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Bill not found"));
    }

    /** The amount for people: 1,200.00 EUR. */
    static String money(long minorUnits, String currency) {
        int digits;
        try {
            digits = Math.max(Currency.getInstance(currency).getDefaultFractionDigits(), 0);
        } catch (IllegalArgumentException | NullPointerException e) {
            digits = 2;
        }
        return String.format(Locale.ENGLISH, "%,." + digits + "f %s", BigDecimal.valueOf(minorUnits, digits),
                Objects.toString(currency, "")).trim();
    }

    private static String networkName(String brand) {
        if (brand == null) {
            return "Card";
        }
        return switch (brand.toLowerCase(Locale.ROOT)) {
            case "visa" -> "Visa";
            case "mc" -> "Mastercard";
            default -> brand;
        };
    }

    private static String countryName(String countryCode) {
        if (countryCode == null) {
            return "this country";
        }
        String name = new Locale("", countryCode).getDisplayCountry(Locale.ENGLISH);
        return name.isBlank() ? countryCode : name;
    }

    /** counterpartyAccountNotFound becomes "counterparty account not found". */
    private static String words(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        return value.replaceAll("([a-z0-9])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
    }

    private static Instant instant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static String value(Object value) {
        return value == null ? null : blankToNull(value.toString());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
