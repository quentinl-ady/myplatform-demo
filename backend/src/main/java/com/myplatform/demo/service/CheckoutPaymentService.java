package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.checkout.Amount;
import com.adyen.model.checkout.Payment;
import com.adyen.model.checkout.PaymentCancelRequest;
import com.adyen.model.checkout.PaymentCancelResponse;
import com.adyen.model.checkout.PaymentCaptureRequest;
import com.adyen.model.checkout.PaymentCaptureResponse;
import com.adyen.model.checkout.PaymentDetailsResponse;
import com.adyen.model.checkout.PaymentResponse;
import com.adyen.model.checkout.SessionResultResponse;
import com.adyen.model.checkout.Split;
import com.adyen.service.checkout.ModificationsApi;
import com.adyen.service.checkout.PaymentsApi;
import com.adyen.service.exception.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.AdvancedPaymentOptions;
import com.myplatform.demo.dto.CaptureRequest;
import com.myplatform.demo.dto.CheckoutPaymentDTO;
import com.myplatform.demo.dto.SplitLine;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.CheckoutPayment;
import com.myplatform.demo.model.CheckoutPayment.CaptureMode;
import com.myplatform.demo.model.CheckoutPayment.SplitMode;
import com.myplatform.demo.model.CheckoutPaymentOperation;
import com.myplatform.demo.model.CheckoutPaymentOperation.Origin;
import com.myplatform.demo.model.CheckoutPaymentOperation.Type;
import com.myplatform.demo.model.SplitSettings;
import com.myplatform.demo.model.WebhookEvent;
import com.myplatform.demo.repository.CheckoutPaymentOperationRepository;
import com.myplatform.demo.repository.CheckoutPaymentRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import com.myplatform.demo.util.PaymentResultRedirects;
import com.myplatform.demo.util.PaymentSplits;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Advanced checkout options (split, commission, fee allocation, capture delay) and the Captures page:
 * payments authorised with delayed or manual capture, their captures and cancellations.
 */
@Service
public class CheckoutPaymentService {

    private static final Logger log = LoggerFactory.getLogger(CheckoutPaymentService.class);

    /** Card authorisations usually expire after 7 days. */
    public static final int MAX_CAPTURE_DELAY_HOURS = 168;

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final Set<CheckoutPayment.Status> LISTED_STATUSES =
            EnumSet.of(CheckoutPayment.Status.AUTHORISED, CheckoutPayment.Status.PENDING);
    private static final TypeReference<List<SplitLine>> SPLIT_LINES = new TypeReference<>() {
    };

    private final CheckoutPaymentRepository paymentRepository;
    private final CheckoutPaymentOperationRepository operationRepository;
    private final WebhookEventRepository webhookEventRepository;
    private final ObjectMapper objectMapper;
    private final Map<String, PaymentsApi> paymentsApis;
    private final Map<String, ModificationsApi> modificationsApis;

    public CheckoutPaymentService(@Qualifier("pspClient") Client pspClient,
                                  @Qualifier("issuingPspClient") Client issuingPspClient,
                                  CheckoutPaymentRepository paymentRepository,
                                  CheckoutPaymentOperationRepository operationRepository,
                                  WebhookEventRepository webhookEventRepository,
                                  ObjectMapper objectMapper) {
        this.paymentRepository = paymentRepository;
        this.operationRepository = operationRepository;
        this.webhookEventRepository = webhookEventRepository;
        this.objectMapper = objectMapper;
        this.paymentsApis = Map.of(
                PaymentResultRedirects.SOURCE_CHECKOUT, new PaymentsApi(pspClient),
                PaymentResultRedirects.SOURCE_ISSUING_CHECKOUT, new PaymentsApi(issuingPspClient));
        this.modificationsApis = Map.of(
                PaymentResultRedirects.SOURCE_CHECKOUT, new ModificationsApi(pspClient),
                PaymentResultRedirects.SOURCE_ISSUING_CHECKOUT, new ModificationsApi(issuingPspClient));
    }

    // ---------- Advanced options ----------

    public ResolvedPaymentOptions resolve(AdvancedPaymentOptions options, ResolvedPaymentOptions.Target target,
                                          Long amount, String currency, String reference) {
        if (amount == null || amount <= 0) {
            throw new BadRequestException("Enter an amount greater than 0.");
        }

        CaptureMode captureMode = options != null && options.getCaptureMode() != null
                ? options.getCaptureMode()
                : CaptureMode.IMMEDIATE;
        Integer captureDelayHours = null;
        if (captureMode == CaptureMode.DELAYED) {
            captureDelayHours = options.getCaptureDelayHours();
            if (captureDelayHours == null || captureDelayHours < 1 || captureDelayHours > MAX_CAPTURE_DELAY_HOURS) {
                throw new BadRequestException("The capture delay must be between 1 and " + MAX_CAPTURE_DELAY_HOURS + " hours.");
            }
        }

        SplitMode splitMode;
        SplitSettings splitSettings;
        List<Split> splits;
        SplitSettings customSplit = options != null ? options.getSplit() : null;
        if (customSplit != null) {
            splitMode = SplitMode.CUSTOM;
            splitSettings = validatedSplit(customSplit, amount);
            splits = buildSplits(splitSettings, amount, amount, currency, reference, target.balanceAccountId());
        } else if ("marketplace".equals(target.activityReason())) {
            splitMode = SplitMode.MARKETPLACE_DEFAULT;
            splitSettings = PaymentSplits.marketplaceDefault();
            splits = buildSplits(splitSettings, amount, amount, currency, reference, target.balanceAccountId());
        } else if ("embeddedPayment".equals(target.activityReason())) {
            splitMode = SplitMode.STORE_PROFILE;
            splitSettings = null;
            splits = null;
        } else {
            splitMode = SplitMode.NONE;
            splitSettings = null;
            splits = null;
        }

        String trackingId = captureMode == CaptureMode.IMMEDIATE ? null : UUID.randomUUID().toString();
        return new ResolvedPaymentOptions(target, reference, amount, currency, options != null,
                captureMode, captureDelayHours, splitMode, splitSettings, splits, trackingId);
    }

    /** Records a Drop-in payment with delayed or manual capture. Returns its id, or null when it isn't tracked. */
    public String recordSession(ResolvedPaymentOptions options, String sessionId) {
        if (!options.tracked()) {
            return null;
        }
        CheckoutPayment payment = newPayment(options, CheckoutPayment.Channel.DROPIN);
        payment.setSessionId(sessionId);
        payment.setStatus(CheckoutPayment.Status.CREATED);
        paymentRepository.save(payment);
        return payment.getId();
    }

    /**
     * Records a saved-card payment with delayed or manual capture. The payment already happened, so a
     * storage failure is only logged. Returns the id, or null when the payment isn't tracked or wasn't stored.
     */
    public String recordTokenPayment(ResolvedPaymentOptions options, PaymentResponse response) {
        if (!options.tracked()) {
            return null;
        }
        try {
            CheckoutPayment payment = newPayment(options, CheckoutPayment.Channel.SAVED_CARD);
            applyResult(payment, response.getPspReference(),
                    response.getResultCode() != null ? response.getResultCode().getValue() : null,
                    response.getRefusalReason());
            paymentRepository.save(payment);
            return payment.getId();
        } catch (Exception e) {
            log.error("Could not store saved-card payment {} for the Captures page", response.getPspReference(), e);
            return null;
        }
    }

    /** Result of a Drop-in payment that went through a redirect. Never throws. */
    public void recordRedirectResult(String paymentId, PaymentDetailsResponse response) {
        if (paymentId == null || paymentId.isBlank() || response == null) {
            return;
        }
        try {
            paymentRepository.findById(paymentId)
                    .filter(this::awaitingResult)
                    // The paymentId comes from the return URL; only accept the result of the same order.
                    .filter(payment -> response.getMerchantReference() == null
                            || response.getMerchantReference().equals(payment.getMerchantReference()))
                    .ifPresent(payment -> {
                        applyResult(payment, response.getPspReference(),
                                response.getResultCode() != null ? response.getResultCode().getValue() : null,
                                response.getRefusalReason());
                        paymentRepository.save(payment);
                    });
        } catch (Exception e) {
            log.warn("Could not store the redirect result of payment {}: {}", paymentId, e.getMessage());
        }
    }

    public CheckoutPaymentDTO syncSessionResult(String paymentId, String userId, String sessionResult)
            throws IOException, ApiException {
        CheckoutPayment payment = findOwned(paymentId, userId);
        if (sessionResult == null || sessionResult.isBlank()) {
            throw new BadRequestException("The session result is missing.");
        }
        if (payment.getSessionId() != null && awaitingResult(payment)) {
            SessionResultResponse result = paymentsApis.get(payment.getSource())
                    .getResultOfPaymentSession(payment.getSessionId(), sessionResult);
            String resultCode = result.getStatus() == null ? null : switch (result.getStatus()) {
                case COMPLETED -> "Authorised";
                case PAYMENTPENDING -> "Pending";
                case REFUSED -> "Refused";
                case CANCELED, EXPIRED -> "Cancelled";
                case ACTIVE -> null;
            };
            if (resultCode != null) {
                applyResult(payment, sessionPspReference(result), resultCode, null);
                payment = paymentRepository.save(payment);
            }
        }
        return toDto(payment, Instant.now());
    }

    // ---------- Captures page ----------

    public List<CheckoutPaymentDTO> list(String ownerUserId) {
        List<CheckoutPayment> payments = paymentRepository
                .findTop100ByOwnerUserIdAndStatusInOrderByCreatedAtDesc(ownerUserId, LISTED_STATUSES);
        if (applyStoredWebhooks(payments)) {
            payments = paymentRepository.findTop100ByOwnerUserIdAndStatusInOrderByCreatedAtDesc(ownerUserId, LISTED_STATUSES);
        }
        Instant now = Instant.now();
        return payments.stream().map(payment -> toDto(payment, now)).toList();
    }

    public CheckoutPaymentDTO capture(String paymentId, CaptureRequest request) throws IOException, ApiException {
        CheckoutPayment payment = findOwned(paymentId, request.getUserId());
        Totals totals = totals(payment, Instant.now());
        ensureOpen(payment, totals, "captured");

        long amount = request.getAmount() != null ? request.getAmount() : totals.remaining();
        if (amount <= 0) {
            throw new BadRequestException("Enter an amount greater than 0.");
        }
        if (amount > totals.remaining()) {
            throw new BadRequestException("The amount can't be higher than the amount left to capture.");
        }

        long captureNumber = payment.getOperations().stream().filter(op -> op.getType() == Type.CAPTURE).count() + 1;
        String reference = payment.getMerchantReference() + "-CAPTURE-" + captureNumber;
        List<Split> splits = captureSplits(payment, request.getSplit(), amount, reference);

        PaymentCaptureRequest captureRequest = new PaymentCaptureRequest()
                .amount(new Amount().currency(payment.getCurrency()).value(amount))
                .merchantAccount(payment.getMerchantAccount())
                .reference(reference);
        if (splits != null) {
            captureRequest.setSplits(splits);
        }
        PaymentCaptureResponse response = modificationsApis.get(payment.getSource())
                .captureAuthorisedPayment(payment.getPspReference(), captureRequest);

        CheckoutPaymentOperation operation = newOperation(Type.CAPTURE, CheckoutPaymentOperation.Status.RECEIVED,
                Origin.PLATFORM, amount, reference, response.getPspReference());
        operation.setSplitsJson(splits != null ? writeLines(PaymentSplits.toLines(splits)) : null);
        payment.addOperation(operation);
        return toDto(paymentRepository.save(payment), Instant.now());
    }

    public CheckoutPaymentDTO cancel(String paymentId, String userId) throws IOException, ApiException {
        CheckoutPayment payment = findOwned(paymentId, userId);
        Totals totals = totals(payment, Instant.now());
        ensureOpen(payment, totals, "cancelled");
        if (!totals.cancellable()) {
            throw new ConflictException("A payment can't be cancelled once it is captured, even partly.");
        }

        String reference = payment.getMerchantReference() + "-CANCEL";
        PaymentCancelRequest cancelRequest = new PaymentCancelRequest()
                .merchantAccount(payment.getMerchantAccount())
                .reference(reference);
        PaymentCancelResponse response = modificationsApis.get(payment.getSource())
                .cancelAuthorisedPaymentByPspReference(payment.getPspReference(), cancelRequest);

        payment.addOperation(newOperation(Type.CANCEL, CheckoutPaymentOperation.Status.RECEIVED,
                Origin.PLATFORM, totals.remaining(), reference, response.getPspReference()));
        return toDto(paymentRepository.save(payment), Instant.now());
    }

    // ---------- Webhooks ----------

    /** Applies AUTHORISATION, CAPTURE, CAPTURE_FAILED and CANCELLATION notifications. Never throws. */
    public void applyWebhook(String rawJson) {
        for (JsonNode item : notificationItems(rawJson)) {
            applySafely(item);
        }
    }

    /**
     * Webhooks may have been stored by another backend sharing the database, without this logic.
     * Returns true when a payment changed.
     */
    private boolean applyStoredWebhooks(List<CheckoutPayment> payments) {
        Set<String> references = new HashSet<>();
        for (CheckoutPayment payment : payments) {
            if (payment.getStatus() == CheckoutPayment.Status.PENDING && payment.getPspReference() != null) {
                references.add(payment.getPspReference());
            }
            for (CheckoutPaymentOperation operation : payment.getOperations()) {
                if (operation.getStatus() == CheckoutPaymentOperation.Status.RECEIVED && operation.getPspReference() != null) {
                    references.add(operation.getPspReference());
                }
            }
        }
        if (references.isEmpty()) {
            return false;
        }
        boolean changed = false;
        try {
            for (WebhookEvent event : webhookEventRepository.findByResourceIdInOrderByReceivedAtAsc(references)) {
                for (JsonNode item : notificationItems(event.getRawJson())) {
                    if (references.contains(text(item, "pspReference"))) {
                        changed |= applySafely(item);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not read stored webhooks for the Captures page: {}", e.getMessage());
        }
        return changed;
    }

    private boolean applySafely(JsonNode item) {
        try {
            return applyNotificationItem(item);
        } catch (Exception e) {
            log.warn("Could not apply {} webhook {} to the Captures page: {}",
                    text(item, "eventCode"), text(item, "pspReference"), e.getMessage());
            return false;
        }
    }

    private boolean applyNotificationItem(JsonNode item) {
        String eventCode = text(item, "eventCode");
        String pspReference = text(item, "pspReference");
        if (eventCode == null || pspReference == null) {
            return false;
        }
        boolean success = "true".equalsIgnoreCase(text(item, "success"));
        String reason = text(item, "reason");
        return switch (eventCode) {
            case "AUTHORISATION" -> applyAuthorisation(item, pspReference, success, reason);
            case "CAPTURE" -> applyModification(Type.CAPTURE, item, pspReference,
                    success ? CheckoutPaymentOperation.Status.SUCCEEDED : CheckoutPaymentOperation.Status.FAILED, reason);
            case "CAPTURE_FAILED" -> applyModification(Type.CAPTURE, item, pspReference,
                    CheckoutPaymentOperation.Status.FAILED, reason);
            case "CANCELLATION" -> applyModification(Type.CANCEL, item, pspReference,
                    success ? CheckoutPaymentOperation.Status.SUCCEEDED : CheckoutPaymentOperation.Status.FAILED, reason);
            default -> false;
        };
    }

    private boolean applyAuthorisation(JsonNode item, String pspReference, boolean success, String reason) {
        Optional<CheckoutPayment> match = paymentRepository.findFirstByPspReference(pspReference);
        if (match.isEmpty()) {
            // The Drop-in result never reached the backend (tab closed before onPaymentCompleted).
            String merchantAccount = text(item, "merchantAccountCode");
            String merchantReference = text(item, "merchantReference");
            Long value = amountValue(item);
            if (merchantAccount != null && merchantReference != null && value != null) {
                match = paymentRepository.findFirstByMerchantAccountAndMerchantReferenceAndAmountAndStatusOrderByCreatedAtDesc(
                        merchantAccount, merchantReference, value, CheckoutPayment.Status.CREATED);
            }
        }
        if (match.isEmpty() || !awaitingResult(match.get())) {
            return false;
        }
        CheckoutPayment payment = match.get();
        applyResult(payment, pspReference, success ? "Authorised" : "Refused", reason);
        paymentRepository.save(payment);
        return true;
    }

    private boolean applyModification(Type type, JsonNode item, String pspReference,
                                      CheckoutPaymentOperation.Status status, String reason) {
        Optional<CheckoutPaymentOperation> existing = operationRepository.findFirstByPspReference(pspReference);
        if (existing.isPresent()) {
            CheckoutPaymentOperation operation = existing.get();
            if (operation.getStatus() == status || operation.getStatus() == CheckoutPaymentOperation.Status.FAILED) {
                return false;
            }
            operation.setStatus(status);
            operation.setReason(status == CheckoutPaymentOperation.Status.FAILED ? reason : null);
            operationRepository.save(operation);
            return true;
        }

        // Capture or cancellation made outside the Captures page (automatic capture, Customer Area...).
        String originalReference = text(item, "originalReference");
        if (originalReference == null) {
            return false;
        }
        Optional<CheckoutPayment> payment = paymentRepository.findFirstByPspReference(originalReference);
        if (payment.isEmpty()) {
            return false;
        }
        CheckoutPaymentOperation operation = newOperation(type, status, Origin.ADYEN, amountValue(item),
                text(item, "merchantReference"), pspReference);
        operation.setReason(status == CheckoutPaymentOperation.Status.FAILED ? reason : null);
        payment.get().addOperation(operation);
        paymentRepository.save(payment.get());
        return true;
    }

    // ---------- Helpers ----------

    private CheckoutPayment findOwned(String paymentId, String userId) {
        return paymentRepository.findById(paymentId)
                .filter(payment -> payment.getOwnerUserId().equals(userId))
                .orElseThrow(() -> new ResourceNotFoundException("Payment not found"));
    }

    private boolean awaitingResult(CheckoutPayment payment) {
        return payment.getStatus() == CheckoutPayment.Status.CREATED || payment.getStatus() == CheckoutPayment.Status.PENDING;
    }

    private SplitSettings validatedSplit(SplitSettings split, long amount) {
        if (split.getCommissionType() == null) {
            throw new BadRequestException("Choose a percentage or a fixed amount for the platform commission.");
        }
        SplitSettings settings = new SplitSettings();
        settings.setCommissionType(split.getCommissionType());
        settings.setFeeAllocation(split.getFeeAllocation() != null
                ? split.getFeeAllocation()
                : SplitSettings.FeeAllocation.PLATFORM);
        if (split.getCommissionType() == SplitSettings.CommissionType.PERCENTAGE) {
            BigDecimal percentage = split.getCommissionPercentage();
            if (percentage == null || percentage.signum() < 0 || percentage.compareTo(HUNDRED) > 0) {
                throw new BadRequestException("The commission percentage must be between 0 and 100.");
            }
            if (percentage.stripTrailingZeros().scale() > 2) {
                throw new BadRequestException("The commission percentage can have up to 2 decimals.");
            }
            settings.setCommissionPercentage(percentage.setScale(2, RoundingMode.UNNECESSARY));
        } else {
            Long commissionAmount = split.getCommissionAmount();
            if (commissionAmount == null || commissionAmount < 0) {
                throw new BadRequestException("Enter a commission amount of 0 or more.");
            }
            if (commissionAmount > amount) {
                throw new BadRequestException("The commission can't be higher than the amount.");
            }
            settings.setCommissionAmount(commissionAmount);
        }
        return settings;
    }

    private List<Split> buildSplits(SplitSettings settings, long amount, long paymentAmount, String currency,
                                    String reference, String balanceAccountId) {
        if (balanceAccountId == null || balanceAccountId.isBlank()) {
            throw new BadRequestException("The sub-merchant has no balance account to receive the funds.");
        }
        long commission = PaymentSplits.commission(settings, amount, paymentAmount);
        return PaymentSplits.build(amount, commission, currency, reference, balanceAccountId, settings.getFeeAllocation());
    }

    private List<Split> captureSplits(CheckoutPayment payment, SplitSettings override, long amount, String reference) {
        if (override != null) {
            SplitSettings settings = validatedSplit(override, amount);
            return buildSplits(settings, amount, amount, payment.getCurrency(), reference, payment.getBalanceAccountId());
        }
        if (payment.getSplitMode() == SplitMode.CUSTOM || payment.getSplitMode() == SplitMode.MARKETPLACE_DEFAULT) {
            // A capture without split instructions books the captured amount to the liable balance account.
            return buildSplits(payment.getSplitSettings(), amount, payment.getAmount(), payment.getCurrency(),
                    reference, payment.getBalanceAccountId());
        }
        // Adyen applies the store split profile to the captured amount.
        return null;
    }

    private CheckoutPayment newPayment(ResolvedPaymentOptions options, CheckoutPayment.Channel channel) {
        ResolvedPaymentOptions.Target target = options.target();
        CheckoutPayment payment = new CheckoutPayment();
        payment.setId(options.trackingId());
        payment.setOwnerUserId(target.ownerUserId());
        payment.setSubMerchantUserId(target.subMerchantUserId());
        payment.setSource(target.source());
        payment.setChannel(channel);
        payment.setMerchantAccount(target.merchantAccount());
        payment.setMerchantReference(options.reference());
        payment.setStoreReference(target.storeReference());
        payment.setBalanceAccountId(target.balanceAccountId());
        payment.setAmount(options.amount());
        payment.setCurrency(options.currency());
        payment.setCaptureMode(options.captureMode());
        payment.setCaptureDelayHours(options.captureDelayHours());
        payment.setSplitMode(options.splitMode());
        payment.setSplitSettings(options.splitSettings());
        payment.setSplitsJson(options.splits() != null ? writeLines(PaymentSplits.toLines(options.splits())) : null);
        return payment;
    }

    private static CheckoutPaymentOperation newOperation(Type type, CheckoutPaymentOperation.Status status, Origin origin,
                                                         Long amount, String reference, String pspReference) {
        CheckoutPaymentOperation operation = new CheckoutPaymentOperation();
        operation.setType(type);
        operation.setStatus(status);
        operation.setOrigin(origin);
        operation.setAmount(amount);
        operation.setReference(reference);
        operation.setPspReference(pspReference);
        return operation;
    }

    private static void applyResult(CheckoutPayment payment, String pspReference, String resultCode, String refusalReason) {
        CheckoutPayment.Status status = statusFor(resultCode);
        if (pspReference != null) {
            payment.setPspReference(pspReference);
        }
        payment.setStatus(status);
        payment.setResultCode(resultCode);
        payment.setRefusalReason(status == CheckoutPayment.Status.REFUSED ? refusalReason : null);
        if (status == CheckoutPayment.Status.AUTHORISED && payment.getAuthorisedAt() == null) {
            payment.setAuthorisedAt(Instant.now());
        }
    }

    private static CheckoutPayment.Status statusFor(String resultCode) {
        if (resultCode == null) {
            return CheckoutPayment.Status.ERROR;
        }
        return switch (resultCode) {
            case "Authorised", "PartiallyAuthorised" -> CheckoutPayment.Status.AUTHORISED;
            case "Pending", "Received" -> CheckoutPayment.Status.PENDING;
            case "Refused" -> CheckoutPayment.Status.REFUSED;
            case "Cancelled" -> CheckoutPayment.Status.NOT_COMPLETED;
            default -> CheckoutPayment.Status.ERROR;
        };
    }

    /** pspReference of the authorised payment of the session, or of its last attempt. */
    private static String sessionPspReference(SessionResultResponse result) {
        List<Payment> payments = result.getPayments();
        if (payments == null || payments.isEmpty()) {
            return null;
        }
        return payments.stream()
                .filter(payment -> payment.getResultCode() == Payment.ResultCodeEnum.AUTHORISED)
                .findFirst()
                .orElse(payments.get(payments.size() - 1))
                .getPspReference();
    }

    /** @param released amount Adyen gave back to the shopper after a partial capture */
    private record Totals(long captured, long pendingCapture, long remaining, long released,
                          CheckoutPaymentOperation cancel, boolean autoCaptureDue, Instant scheduledCaptureAt) {

        /** Adyen can't cancel a payment after a capture, even a partial one. */
        boolean cancellable() {
            return remaining > 0 && captured == 0 && pendingCapture == 0;
        }
    }

    private static Totals totals(CheckoutPayment payment, Instant now) {
        long captured = 0;
        long pendingCapture = 0;
        CheckoutPaymentOperation cancel = null;
        boolean anyOperation = false;
        boolean captureRefusedForBalance = false;
        for (CheckoutPaymentOperation operation : payment.getOperations()) {
            if (operation.getStatus() == CheckoutPaymentOperation.Status.FAILED) {
                captureRefusedForBalance |= operation.getType() == Type.CAPTURE && insufficientBalance(operation);
                continue;
            }
            anyOperation = true;
            if (operation.getType() == Type.CANCEL) {
                cancel = operation;
            } else if (operation.getAmount() != null) {
                if (operation.getStatus() == CheckoutPaymentOperation.Status.SUCCEEDED) {
                    captured += operation.getAmount();
                } else {
                    pendingCapture += operation.getAmount();
                }
            }
        }
        Instant scheduledCaptureAt = scheduledCaptureAt(payment);
        // Adyen sends no webhook for automatic captures unless the merchant account is configured for it.
        boolean autoCaptureDue = scheduledCaptureAt != null && !now.isBefore(scheduledCaptureAt) && !anyOperation;
        long left = payment.getStatus() == CheckoutPayment.Status.AUTHORISED && cancel == null && !autoCaptureDue
                ? Math.max(0, payment.getAmount() - captured - pendingCapture)
                : 0;
        // Unless multiple partial captures are enabled on the merchant account, Adyen releases the rest of the
        // amount after the first partial capture, so a later capture fails with "Insufficient balance on payment".
        boolean remainderReleased = captureRefusedForBalance && captured > 0;
        long remaining = remainderReleased ? 0 : left;
        long released = remainderReleased ? left : 0;
        return new Totals(captured, pendingCapture, remaining, released, cancel, autoCaptureDue, scheduledCaptureAt);
    }

    private static boolean insufficientBalance(CheckoutPaymentOperation operation) {
        return operation.getReason() != null
                && operation.getReason().toLowerCase(Locale.ROOT).contains("insufficient balance");
    }

    private static Instant scheduledCaptureAt(CheckoutPayment payment) {
        if (payment.getCaptureMode() != CaptureMode.DELAYED || payment.getCaptureDelayHours() == null) {
            return null;
        }
        Instant start = payment.getAuthorisedAt() != null ? payment.getAuthorisedAt() : payment.getCreatedAt();
        return start != null ? start.plus(Duration.ofHours(payment.getCaptureDelayHours())) : null;
    }

    private static void ensureOpen(CheckoutPayment payment, Totals totals, String action) {
        if (payment.getStatus() != CheckoutPayment.Status.AUTHORISED || payment.getPspReference() == null) {
            throw new ConflictException("Only authorised payments can be " + action + ".");
        }
        if (totals.cancel() != null) {
            throw new ConflictException("This payment is already cancelled.");
        }
        if (totals.autoCaptureDue()) {
            throw new ConflictException("Adyen has already captured this payment automatically.");
        }
        if (totals.remaining() <= 0) {
            throw new ConflictException("Nothing is left to " + ("captured".equals(action) ? "capture" : "cancel") + " on this payment.");
        }
    }

    private static CheckoutPaymentDTO.State state(CheckoutPayment payment, Totals totals) {
        switch (payment.getStatus()) {
            case CREATED, PENDING -> {
                return CheckoutPaymentDTO.State.PENDING_AUTHORISATION;
            }
            case AUTHORISED -> {
            }
            default -> {
                return CheckoutPaymentDTO.State.NOT_AUTHORISED;
            }
        }
        if (totals.cancel() != null) {
            return totals.cancel().getStatus() == CheckoutPaymentOperation.Status.SUCCEEDED
                    ? CheckoutPaymentDTO.State.CANCELLED
                    : CheckoutPaymentDTO.State.CANCEL_SUBMITTED;
        }
        if (totals.autoCaptureDue()) {
            return CheckoutPaymentDTO.State.AUTO_CAPTURED;
        }
        if (totals.pendingCapture() > 0) {
            return CheckoutPaymentDTO.State.CAPTURE_SUBMITTED;
        }
        if (totals.captured() >= payment.getAmount()) {
            return CheckoutPaymentDTO.State.CAPTURED;
        }
        if (totals.captured() > 0) {
            return CheckoutPaymentDTO.State.PARTIALLY_CAPTURED;
        }
        return payment.getCaptureMode() == CaptureMode.DELAYED
                ? CheckoutPaymentDTO.State.CAPTURE_SCHEDULED
                : CheckoutPaymentDTO.State.AWAITING_CAPTURE;
    }

    private CheckoutPaymentDTO toDto(CheckoutPayment payment, Instant now) {
        Totals totals = totals(payment, now);
        CheckoutPaymentDTO dto = new CheckoutPaymentDTO();
        dto.setId(payment.getId());
        dto.setSource(payment.getSource());
        dto.setChannel(payment.getChannel());
        dto.setMerchantReference(payment.getMerchantReference());
        dto.setPspReference(payment.getPspReference());
        dto.setStoreReference(payment.getStoreReference());
        dto.setBalanceAccountId(payment.getBalanceAccountId());
        dto.setAmount(payment.getAmount());
        dto.setCurrency(payment.getCurrency());
        dto.setStatus(payment.getStatus());
        dto.setState(state(payment, totals));
        dto.setRefusalReason(payment.getRefusalReason());
        dto.setCaptureMode(payment.getCaptureMode());
        dto.setCaptureDelayHours(payment.getCaptureDelayHours());
        dto.setScheduledCaptureAt(totals.scheduledCaptureAt());
        dto.setCapturedAmount(totals.captured());
        dto.setPendingCaptureAmount(totals.pendingCapture());
        dto.setRemainingAmount(totals.remaining());
        dto.setReleasedAmount(totals.released());
        dto.setCanCapture(totals.remaining() > 0);
        dto.setCanCancel(totals.cancellable());
        dto.setSplitMode(payment.getSplitMode());
        dto.setSplitSettings(payment.getSplitSettings());
        dto.setSplits(readLines(payment.getSplitsJson()));
        dto.setCreatedAt(payment.getCreatedAt());
        dto.setAuthorisedAt(payment.getAuthorisedAt());
        List<CheckoutPaymentDTO.Operation> operations = new ArrayList<>();
        for (CheckoutPaymentOperation operation : payment.getOperations()) {
            CheckoutPaymentDTO.Operation item = new CheckoutPaymentDTO.Operation();
            item.setId(operation.getId());
            item.setType(operation.getType());
            item.setStatus(operation.getStatus());
            item.setOrigin(operation.getOrigin());
            item.setAmount(operation.getAmount());
            item.setReference(operation.getReference());
            item.setPspReference(operation.getPspReference());
            item.setReason(operation.getReason());
            item.setSplits(readLines(operation.getSplitsJson()));
            item.setCreatedAt(operation.getCreatedAt());
            item.setUpdatedAt(operation.getUpdatedAt());
            operations.add(item);
        }
        dto.setOperations(operations);
        return dto;
    }

    private List<JsonNode> notificationItems(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return List.of();
        }
        try {
            JsonNode items = objectMapper.readTree(rawJson).get("notificationItems");
            if (items == null || !items.isArray()) {
                return List.of();
            }
            List<JsonNode> result = new ArrayList<>();
            for (JsonNode wrapper : items) {
                result.add(wrapper.has("NotificationRequestItem") ? wrapper.get("NotificationRequestItem") : wrapper);
            }
            return result;
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node != null ? node.get(field) : null;
        return value != null && value.isValueNode() && !value.isNull() ? value.asText() : null;
    }

    private static Long amountValue(JsonNode item) {
        JsonNode value = item.path("amount").path("value");
        return value.isNumber() ? value.asLong() : null;
    }

    private String writeLines(List<SplitLine> lines) {
        try {
            return objectMapper.writeValueAsString(lines);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private List<SplitLine> readLines(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, SPLIT_LINES);
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }
}
