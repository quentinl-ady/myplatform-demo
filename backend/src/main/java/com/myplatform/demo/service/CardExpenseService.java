package com.myplatform.demo.service;

import com.myplatform.demo.dto.CardExpenseDTO;
import com.myplatform.demo.dto.CardExpenseRequest;
import com.myplatform.demo.dto.CardExpenseSettingsDTO;
import com.myplatform.demo.dto.CardTransferDTO;
import com.myplatform.demo.dto.ReceiptUploadRequest;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.CardExpense;
import com.myplatform.demo.model.CardExpenseReceipt;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.BillRepository;
import com.myplatform.demo.repository.CardExpenseReceiptRepository;
import com.myplatform.demo.repository.CardExpenseRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.ExpenseCategories;
import com.myplatform.demo.util.InvoiceMath;
import com.myplatform.demo.util.Receipts;
import com.myplatform.demo.util.VatRates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClientException;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Card expenses: the category, VAT rate, note and receipt the user gives a payment made with one of their cards, so
 * that the journal books it to its expense account instead of Suspense. A payment made with the single-use card of a
 * bill is booked with the bill instead.
 */
@Service
public class CardExpenseService {

    private static final Logger log = LoggerFactory.getLogger(CardExpenseService.class);

    public static final int MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_NOTE = 500;
    private static final int MAX_MERCHANT = 100;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final Pattern TRANSFER_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern MCC = Pattern.compile("[0-9]{4}");

    private final CardExpenseRepository expenseRepository;
    private final CardExpenseReceiptRepository receiptRepository;
    private final BillRepository billRepository;
    private final UserRepository userRepository;
    private final CardTransferService cardTransferService;
    private final TransactionTemplate transactionTemplate;
    /** The changes of the expense of a payment run one at a time, under the lock its transfer id maps to. */
    private final Object[] locks = Stream.generate(Object::new).limit(64).toArray();

    /** A receipt to download. */
    public record ReceiptFile(byte[] content, String contentType, String fileName) {
    }

    public CardExpenseService(CardExpenseRepository expenseRepository,
                              CardExpenseReceiptRepository receiptRepository,
                              BillRepository billRepository,
                              UserRepository userRepository,
                              CardTransferService cardTransferService,
                              PlatformTransactionManager transactionManager) {
        this.expenseRepository = expenseRepository;
        this.receiptRepository = receiptRepository;
        this.billRepository = billRepository;
        this.userRepository = userRepository;
        this.cardTransferService = cardTransferService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public CardExpenseSettingsDTO settings(String userId) {
        User user = user(userId);
        String country = user.getCountryCode();
        List<BigDecimal> rates = VatRates.forCountry(country);
        return new CardExpenseSettingsDTO(InvoiceService.currency(user), VatRates.taxLabel(country), rates, rates.get(0),
                ExpenseCategories.ALL, MAX_RECEIPT_BYTES, Receipts.TYPES);
    }

    /** The payments the user classified, the latest first. */
    public List<CardExpenseDTO> list(String userId) {
        user(userId);
        return expenseRepository.findByUserId(userId).stream()
                .sorted(Comparator.comparing(CardExpense::getOccurredAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(CardExpenseService::toDto)
                .toList();
    }

    /** Classifies a payment, or changes how it's classified. */
    public CardExpenseDTO save(String userId, String transferId, CardExpenseRequest request) {
        User user = user(userId);
        if (request == null) {
            throw new BadRequestException("The expense is missing.");
        }
        String category = SupplierService.text(request.category(), 10, "The category");
        if (category == null || ExpenseCategories.find(category).isEmpty()) {
            throw new BadRequestException("Choose a category from the list.");
        }
        BigDecimal vatRate = vatRate(request.vatRate(), user);
        String note = SupplierService.text(request.note(), MAX_NOTE, "The note");
        synchronized (lockOf(transferId)) {
            CardExpense expense = findOrNew(user, transferId);
            expense.setCategory(category);
            expense.setVatRate(vatRate);
            expense.setNote(note);
            return toDto(expenseRepository.save(expense));
        }
    }

    /**
     * Adds the receipt of a payment, or replaces it. A payment not classified yet is booked to the category its
     * merchant suggests, at the standard VAT rate.
     */
    public CardExpenseDTO saveReceipt(String userId, String transferId, ReceiptUploadRequest request) {
        User user = user(userId);
        Receipts.Receipt receipt;
        try {
            receipt = Receipts.decode(request != null ? request.fileName() : null, request != null ? request.data() : null,
                    MAX_RECEIPT_BYTES);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException(e.getMessage());
        }
        synchronized (lockOf(transferId)) {
            CardExpense found = findOrNew(user, transferId);
            CardExpense expense = found.getId() == null ? expenseRepository.save(found) : found;
            return transactionTemplate.execute(status -> {
                receiptRepository.deleteByExpenseId(expense.getId());
                CardExpenseReceipt file = new CardExpenseReceipt();
                file.setExpenseId(expense.getId());
                file.setData(receipt.base64());
                receiptRepository.save(file);
                expense.setReceiptName(receipt.fileName());
                expense.setReceiptType(receipt.contentType());
                expense.setReceiptSize(receipt.size());
                expense.setReceiptUploadedAt(Instant.now());
                return toDto(expenseRepository.save(expense));
            });
        }
    }

    public ReceiptFile receipt(String userId, String transferId) {
        CardExpense expense = owned(userId, transferId);
        CardExpenseReceipt file = expense.getReceiptName() == null ? null
                : receiptRepository.findById(expense.getId()).orElse(null);
        if (file == null || file.getData() == null) {
            throw new ResourceNotFoundException("Receipt not found");
        }
        return new ReceiptFile(Base64.getDecoder().decode(file.getData()), expense.getReceiptType(), expense.getReceiptName());
    }

    public CardExpenseDTO deleteReceipt(String userId, String transferId) {
        synchronized (lockOf(transferId)) {
            CardExpense expense = owned(userId, transferId);
            return transactionTemplate.execute(status -> {
                receiptRepository.deleteByExpenseId(expense.getId());
                expense.setReceiptName(null);
                expense.setReceiptType(null);
                expense.setReceiptSize(null);
                expense.setReceiptUploadedAt(null);
                return toDto(expenseRepository.save(expense));
            });
        }
    }

    /** Forgets how the payment is classified, and its receipt: the journal books it to Suspense again. */
    public void delete(String userId, String transferId) {
        synchronized (lockOf(transferId)) {
            CardExpense expense = owned(userId, transferId);
            transactionTemplate.executeWithoutResult(status -> {
                receiptRepository.deleteByExpenseId(expense.getId());
                expenseRepository.delete(expense);
            });
        }
    }

    /**
     * Adds to card payments how they are booked: the category their merchant suggests, the expense the user classified,
     * or the bill the single-use card paid.
     */
    public void attach(String userId, List<CardTransferDTO> transfers) {
        if (transfers.isEmpty()) {
            return;
        }
        Set<String> transferIds = transfers.stream().map(CardTransferDTO::getId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Set<String> cards = transfers.stream().map(CardTransferDTO::getPaymentInstrumentId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, CardExpense> expenses = transferIds.isEmpty() ? Map.of()
                : expenseRepository.findByUserIdAndTransferIdIn(userId, transferIds).stream()
                .collect(Collectors.toMap(CardExpense::getTransferId, Function.identity(), (first, other) -> first));
        Map<String, Bill> bills = cards.isEmpty() ? Map.of()
                : billRepository.findByUserIdAndPaymentInstrumentIdIn(userId, cards).stream()
                .collect(Collectors.toMap(Bill::getPaymentInstrumentId, Function.identity(), (first, other) -> first));
        for (CardTransferDTO transfer : transfers) {
            transfer.setSuggestedCategory(ExpenseCategories.forMcc(transfer.getMcc()).code());
            Bill bill = transfer.getPaymentInstrumentId() != null ? bills.get(transfer.getPaymentInstrumentId()) : null;
            if (bill != null) {
                transfer.setBillId(bill.getId());
                transfer.setBillNumber(bill.getNumber());
            }
            CardExpense expense = transfer.getId() != null ? expenses.get(transfer.getId()) : null;
            if (expense != null) {
                transfer.setExpense(toDto(expense));
            }
        }
    }

    /** The expense of the payment, else a new one from the payment as Adyen reports it. */
    private CardExpense findOrNew(User user, String transferId) {
        CardExpense existing = expenseRepository.findFirstByUserIdAndTransferId(user.getId(), transferId).orElse(null);
        if (existing != null) {
            return existing;
        }
        CardTransferDTO transfer = cardTransfer(user, transferId);
        Bill bill = transfer.getPaymentInstrumentId() == null ? null
                : billRepository.findFirstByUserIdAndPaymentInstrumentId(user.getId(), transfer.getPaymentInstrumentId())
                .orElse(null);
        if (bill != null) {
            throw new ConflictException("This payment pays " + bill.getNumber() + ", so it's booked with the bill.");
        }
        String merchant = transfer.getMerchantName() != null ? transfer.getMerchantName().trim() : null;
        CardExpense expense = new CardExpense();
        expense.setUserId(user.getId());
        expense.setTransferId(transferId);
        expense.setPaymentInstrumentId(transfer.getPaymentInstrumentId());
        expense.setMerchantName(merchant == null || merchant.isEmpty() ? null
                : merchant.length() > MAX_MERCHANT ? merchant.substring(0, MAX_MERCHANT).trim() : merchant);
        expense.setMcc(transfer.getMcc() != null && MCC.matcher(transfer.getMcc()).matches() ? transfer.getMcc() : null);
        expense.setDirection(transfer.getDirection());
        expense.setAmount(transfer.getAmount());
        expense.setCurrency(transfer.getCurrency());
        expense.setOccurredAt(instant(transfer.getCreatedAt()));
        expense.setCategory(ExpenseCategories.forMcc(transfer.getMcc()).code());
        expense.setVatRate(VatRates.forCountry(user.getCountryCode()).get(0));
        return expense;
    }

    /** The card payment at Adyen, checked to be one of the user's. */
    private CardTransferDTO cardTransfer(User user, String transferId) {
        if (transferId == null || !TRANSFER_ID.matcher(transferId).matches()) {
            throw new ResourceNotFoundException("Card payment not found");
        }
        String accountHolderId = user.getAccountHolderId();
        if (accountHolderId == null || accountHolderId.isBlank()) {
            throw new BadRequestException("The account has no account holder yet.");
        }
        try {
            return cardTransferService.getCardTransfer(accountHolderId, transferId)
                    .orElseThrow(() -> new ResourceNotFoundException("Card payment not found"));
        } catch (RestClientException | IllegalStateException e) {
            log.warn("Couldn't read card payment {} at Adyen: {}", transferId, e.getMessage());
            throw new BadRequestException("Couldn't read the card payment. Try again.");
        }
    }

    private static BigDecimal vatRate(BigDecimal rate, User user) {
        if (rate == null) {
            return VatRates.forCountry(user.getCountryCode()).get(0);
        }
        String taxLabel = VatRates.taxLabel(user.getCountryCode());
        if (rate.signum() < 0 || rate.compareTo(HUNDRED) > 0) {
            throw new BadRequestException("The " + taxLabel + " rate must be between 0 and 100%.");
        }
        if (rate.stripTrailingZeros().scale() > 2) {
            throw new BadRequestException("The " + taxLabel + " rate can have up to 2 decimals.");
        }
        return rate.setScale(2);
    }

    static CardExpenseDTO toDto(CardExpense expense) {
        InvoiceMath.Amounts split = expense.getAmount() == null ? null
                : InvoiceMath.fromGross(Math.abs(expense.getAmount()), expense.getVatRate());
        CardExpenseDTO.Receipt receipt = expense.getReceiptName() == null ? null
                : new CardExpenseDTO.Receipt(expense.getReceiptName(), expense.getReceiptType(),
                expense.getReceiptSize() != null ? expense.getReceiptSize() : 0, expense.getReceiptUploadedAt());
        return new CardExpenseDTO(
                expense.getId(),
                expense.getTransferId(),
                expense.getPaymentInstrumentId(),
                expense.getMerchantName(),
                expense.getMcc(),
                expense.getDirection(),
                expense.getAmount(),
                expense.getCurrency(),
                expense.getOccurredAt(),
                expense.getCategory(),
                ExpenseCategories.of(expense.getCategory()).name(),
                expense.getVatRate(),
                split != null ? split.net() : null,
                split != null ? split.tax() : null,
                expense.getNote(),
                receipt,
                receipt == null && !"incoming".equals(expense.getDirection()),
                expense.getUpdatedAt());
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private CardExpense owned(String userId, String transferId) {
        return expenseRepository.findFirstByUserIdAndTransferId(userId, transferId)
                .orElseThrow(() -> new ResourceNotFoundException("Expense not found"));
    }

    private Object lockOf(String transferId) {
        return locks[Math.floorMod(Objects.hashCode(transferId), locks.length)];
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
}
