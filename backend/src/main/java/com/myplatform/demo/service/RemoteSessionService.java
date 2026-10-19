package com.myplatform.demo.service;

import com.adyen.model.balanceplatform.AssociationInitiateResponse;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.adyen.model.balanceplatform.RegisterSCAResponse;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.PhoneStepRequest;
import com.myplatform.demo.dto.RemoteApprovalRequest;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.InitiateTransferResponse;
import com.myplatform.demo.model.PendingTransfer;
import com.myplatform.demo.model.RecipientCountry;
import com.myplatform.demo.model.RemoteSession;
import com.myplatform.demo.model.RemoteSession.BatchApproval;
import com.myplatform.demo.model.RemoteSession.Operation;
import com.myplatform.demo.model.RemoteSession.Pairing;
import com.myplatform.demo.model.RemoteSession.StandingOrderApproval;
import com.myplatform.demo.model.RemoteSession.Status;
import com.myplatform.demo.model.RemoteSession.TransactionsApproval;
import com.myplatform.demo.model.RemoteSession.TransferApproval;
import com.myplatform.demo.model.RemoteSession.Type;
import com.myplatform.demo.model.TransferRequest;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.PendingTransferRepository;
import com.myplatform.demo.repository.UserBrandingRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.EmailMask;
import com.myplatform.demo.util.RecipientCountries;
import com.myplatform.demo.util.ScaChallenges;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Registration of a phone as trusted device, and approval of operations on it, started on a computer
 * that shows a QR code. The computer follows the session with its id; the phone acts with the token
 * carried by the link. The phone gets its own SCA challenge: the payload of the operation stays on
 * the server and is sent again to Adyen with the phone's SDK output.
 */
@Service
public class RemoteSessionService {

    private static final int MAX_LABEL_LENGTH = 60;
    private static final Pattern SDK_OUTPUT = Pattern.compile("[A-Za-z0-9+/=_-]+");

    @FunctionalInterface
    private interface PhoneStep {
        Map<String, Object> run() throws IOException, ApiException;
    }

    private final RemoteSessionStore store;
    private final UserRepository userRepository;
    private final UserBrandingRepository brandingRepository;
    private final PendingTransferRepository pendingTransferRepository;
    private final BankAccountResolver bankAccounts;
    private final TrustedDeviceService trustedDevices;
    private final TransferService transferService;
    private final TransferRouteService transferRouteService;
    private final StandingOrderService standingOrderService;
    private final BankTransferService bankTransferService;

    public RemoteSessionService(RemoteSessionStore store,
                                UserRepository userRepository,
                                UserBrandingRepository brandingRepository,
                                PendingTransferRepository pendingTransferRepository,
                                BankAccountResolver bankAccounts,
                                TrustedDeviceService trustedDevices,
                                TransferService transferService,
                                TransferRouteService transferRouteService,
                                StandingOrderService standingOrderService,
                                BankTransferService bankTransferService) {
        this.store = store;
        this.userRepository = userRepository;
        this.brandingRepository = brandingRepository;
        this.pendingTransferRepository = pendingTransferRepository;
        this.bankAccounts = bankAccounts;
        this.trustedDevices = trustedDevices;
        this.transferService = transferService;
        this.transferRouteService = transferRouteService;
        this.standingOrderService = standingOrderService;
        this.bankTransferService = bankTransferService;
    }

    // ---- Computer ----

    /** The caller has checked the email verification code. */
    public Map<String, Object> createPairing(User user, String deviceName) throws IOException, ApiException {
        String physicalPi = bankAccounts.physicalPi(user);
        trustedDevices.requireRoomForDevice(physicalPi);

        String name = truncate(deviceName);
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("deviceName", name);
        Pairing pairing = new Pairing(name, physicalPi, bankAccounts.virtualPi(user));
        return computerView(store.create(Type.PAIRING, user.getId(), pairing, summary));
    }

    public Map<String, Object> createApproval(RemoteApprovalRequest request) throws IOException, ApiException {
        User user = findUser(request.userId());
        Type type = Type.fromValue(request.type())
                .filter(value -> value != Type.PAIRING)
                .orElseThrow(() -> new BadRequestException("Unknown approval type: " + request.type()));

        Operation operation;
        Map<String, Object> summary;
        switch (type) {
            case TRANSFER -> {
                TransferRequest transfer = request.transfer();
                if (transfer == null) {
                    throw new BadRequestException("The transfer to approve is missing");
                }
                transfer.setUserId(user.getId());
                transfer.setSdkOutput(null);
                RecipientCountry recipientCountry = RecipientCountries.require(user.getCurrencyCode(), transfer.getCounterpartyCountry());
                transferRouteService.requireEligible(bankAccounts.balanceAccountId(user), recipientCountry, transfer);
                operation = new TransferApproval(transfer, bankAccounts.transferPi(user), recipientCountry);
                summary = transferSummary(transfer, recipientCountry);
            }
            case STANDING_ORDER -> {
                if (request.standingOrder() == null || request.standingOrder().isEmpty()) {
                    throw new BadRequestException("The scheduled transfer to approve is missing");
                }
                Map<String, Object> standingOrder = new LinkedHashMap<>(request.standingOrder());
                standingOrder.remove("balanceAccountId");
                operation = new StandingOrderApproval(standingOrder, bankAccounts.balanceAccountId(user));
                summary = standingOrderSummary(standingOrder);
            }
            case BATCH -> {
                String accountHolderId = requireAccountHolder(user);
                List<String> transferIds = request.transferIds() == null ? List.of() : request.transferIds().stream()
                        .filter(id -> id != null && !id.isBlank())
                        .distinct()
                        .toList();
                if (transferIds.isEmpty()) {
                    throw new BadRequestException("Select at least one transfer to approve");
                }
                Set<String> pendingIds = pendingTransferRepository.findByAccountHolderId(accountHolderId).stream()
                        .map(PendingTransfer::getTransferId)
                        .collect(Collectors.toSet());
                if (!pendingIds.containsAll(transferIds)) {
                    throw new BadRequestException("Some of these transfers are no longer waiting for approval");
                }
                // The phone must show every transfer it approves, and Adyen can't approve those it doesn't list yet either.
                List<Map<String, Object>> details = transferService.getTransferDetails(transferIds);
                if (details.size() < transferIds.size()) {
                    throw new BadRequestException("Some transfers are still being created. Wait about a minute and try again.");
                }
                operation = new BatchApproval(transferIds);
                summary = batchSummary(details);
            }
            case TRANSACTIONS -> {
                String accountHolderId = requireAccountHolder(user);
                String balanceAccountId = bankAccounts.hasBankAccount(user) ? bankAccounts.balanceAccountId(user) : null;
                operation = new TransactionsApproval(accountHolderId, balanceAccountId);
                summary = Map.of("days", BankTransferService.HISTORY_DAYS);
            }
            default -> throw new BadRequestException("Unknown approval type: " + request.type());
        }
        return computerView(store.create(type, user.getId(), operation, summary));
    }

    public Map<String, Object> status(String sessionId, String userId) {
        return computerView(sessionForUser(sessionId, userId), null);
    }

    public Map<String, Object> cancel(String sessionId, String userId) {
        RemoteSession session = sessionForUser(sessionId, userId);
        session.end(store.now(), Status.CANCELLED);
        return computerView(session, null);
    }

    // ---- Phone ----

    public Map<String, Object> phoneOpen(PhoneStepRequest request) {
        RemoteSession session = sessionForPhone(request.token());
        session.open(store.now(), truncate(request.label()), request.passkeys());
        return phoneView(session, true);
    }

    public Map<String, Object> phoneStatus(PhoneStepRequest request) {
        return phoneView(sessionForPhone(request.token()), false);
    }

    public Map<String, Object> phoneDecline(PhoneStepRequest request) {
        RemoteSession session = sessionForPhone(request.token());
        if (session.isBusy()) {
            throw new ConflictException("Wait for the current step to finish.");
        }
        session.end(store.now(), Status.DECLINED);
        return phoneView(session, false);
    }

    /** Pairing, step 1: Adyen returns what the phone needs to create its passkey. */
    public Map<String, Object> phoneRegister(PhoneStepRequest request) throws IOException, ApiException {
        RemoteSession session = sessionForPhone(request.token());
        Pairing pairing = operation(session, Pairing.class);
        String sdkOutput = requireSdkOutput(request);
        return step(session, "The passkey couldn't be created on the phone.", () -> {
            if (session.isDeviceRegistered()) {
                throw new ConflictException("This phone is already registered.");
            }
            String name = pairing.deviceName() != null ? pairing.deviceName() : defaultDeviceName(session.getPhoneLabel());
            RegisterSCAResponse response = trustedDevices.initiateRegistration(pairing.physicalPi(), sdkOutput, name);
            if (response == null || !Boolean.TRUE.equals(response.getSuccess()) || response.getSdkInput() == null) {
                throw new BadRequestException("The registration of this phone couldn't start. Try again.");
            }
            session.setDeviceId(response.getId());
            return Map.of("sdkInput", response.getSdkInput());
        });
    }

    /** Pairing, step 2: the passkey is registered; the phone may still have to be linked to the virtual bank account. */
    public Map<String, Object> phoneFinishRegistration(PhoneStepRequest request) throws IOException, ApiException {
        RemoteSession session = sessionForPhone(request.token());
        Pairing pairing = operation(session, Pairing.class);
        String sdkOutput = requireSdkOutput(request);
        return step(session, "The registration couldn't be completed on the phone.", () -> {
            if (session.getDeviceId() == null) {
                throw new BadRequestException("Start the registration first.");
            }
            if (session.isDeviceRegistered()) {
                throw new ConflictException("This phone is already registered.");
            }
            RegisterSCAFinalResponse response = trustedDevices.finalizeRegistration(session.getUserId(),
                    pairing.physicalPi(), session.getDeviceId(), sdkOutput, request.kind(), request.platform());
            if (response == null || !Boolean.TRUE.equals(response.getSuccess())) {
                throw new BadRequestException("The passkey was created but the registration couldn't be completed. Try again.");
            }
            session.setDeviceRegistered(true);
            if (pairing.virtualPi() == null) {
                return completed(session, null);
            }
            return Map.of("status", Status.IN_PROGRESS.value(), "associationRequired", true);
        });
    }

    /** Pairing, step 3: the phone confirms with its new passkey that it may approve transfers of the virtual bank account. */
    public Map<String, Object> phoneAssociate(PhoneStepRequest request) throws IOException, ApiException {
        RemoteSession session = sessionForPhone(request.token());
        Pairing pairing = operation(session, Pairing.class);
        return step(session, "The phone couldn't be linked to the bank account.", () -> {
            requireRegistered(session, pairing);
            AssociationInitiateResponse response = transferService.initiateDeviceAssociation(
                    session.getDeviceId(), List.of(pairing.virtualPi()));
            return Map.of("sdkInput", response.getSdkInput());
        });
    }

    public Map<String, Object> phoneFinishAssociation(PhoneStepRequest request) throws IOException, ApiException {
        RemoteSession session = sessionForPhone(request.token());
        Pairing pairing = operation(session, Pairing.class);
        String sdkOutput = requireSdkOutput(request);
        return step(session, "The phone couldn't be linked to the bank account.", () -> {
            requireRegistered(session, pairing);
            transferService.finalizeDeviceAssociation(session.getDeviceId(), List.of(pairing.virtualPi()), sdkOutput);
            return completed(session, null);
        });
    }

    /**
     * Approval, step 1: the operation is sent to Adyen with the SDK output of the phone, which answers
     * with the challenge to sign. Adyen may also accept it without strong customer authentication.
     */
    public Map<String, Object> phoneChallenge(PhoneStepRequest request) throws IOException, ApiException {
        RemoteSession session = sessionForPhone(request.token());
        Operation operation = approvalOperation(session);
        String sdkOutput = requireSdkOutput(request);
        return step(session, "The approval couldn't start on the phone.", () -> {
            if (operation instanceof TransferApproval transfer) {
                return transferChallenge(session, transfer, sdkOutput);
            }
            if (operation instanceof StandingOrderApproval order) {
                Map<String, Object> result = standingOrderService.initiateStandingOrder(
                        order.balanceAccountId(), order.standingOrder(), sdkOutput);
                if ("sca_required".equals(result.get("status"))) {
                    return challenge((String) result.get("authParam1"));
                }
                return completed(session, result.get("standingOrder"));
            }
            if (operation instanceof BatchApproval batch) {
                return batchChallenge(session, batch, sdkOutput);
            }
            if (operation instanceof TransactionsApproval transactions) {
                Map<String, Object> result = bankTransferService.initiateBankTransfers(
                        transactions.accountHolderId(), transactions.balanceAccountId(), sdkOutput);
                if ("sca_required".equals(result.get("status"))) {
                    session.setChallengePeriod((String) result.get("createdSince"), (String) result.get("createdUntil"));
                    return challenge((String) result.get("authParam1"));
                }
                return completed(session, result);
            }
            throw new IllegalStateException("Unsupported operation " + operation);
        });
    }

    /** Approval, step 2: the operation is sent again with the challenge signed by the passkey of the phone. */
    public Map<String, Object> phoneApprove(PhoneStepRequest request) throws IOException, ApiException {
        RemoteSession session = sessionForPhone(request.token());
        Operation operation = approvalOperation(session);
        String sdkOutput = requireSdkOutput(request);
        return step(session, "The approval couldn't be completed on the phone.", () -> {
            if (operation instanceof TransferApproval transfer) {
                transferService.finalizeTransfer(withSdkOutput(transfer.request(), sdkOutput),
                        transfer.paymentInstrumentId(), transfer.recipientCountry());
                return completed(session, Map.of("status", "success"));
            }
            if (operation instanceof StandingOrderApproval order) {
                return completed(session, standingOrderService.finalizeStandingOrder(
                        order.balanceAccountId(), order.standingOrder(), sdkOutput));
            }
            if (operation instanceof BatchApproval batch) {
                return completed(session, transferService.approveTransfers(batch.transferIds(), sdkOutput));
            }
            if (operation instanceof TransactionsApproval transactions) {
                if (session.getCreatedSince() == null) {
                    throw new BadRequestException("Request the approval first.");
                }
                return completed(session, bankTransferService.finalizeBankTransfers(transactions.accountHolderId(),
                        transactions.balanceAccountId(), sdkOutput, session.getCreatedSince(), session.getCreatedUntil()));
            }
            throw new IllegalStateException("Unsupported operation " + operation);
        });
    }

    // ---- Steps ----

    private Map<String, Object> step(RemoteSession session, String failure, PhoneStep step) throws IOException, ApiException {
        if (!session.begin(store.now())) {
            throw notActive(session);
        }
        try {
            return step.run();
        } catch (BadRequestException | ConflictException e) {
            // Written for the user, so the computer shows the same explanation as the phone.
            session.fail(store.now(), e.getMessage());
            throw e;
        } catch (IOException | ApiException | RuntimeException e) {
            session.fail(store.now(), failure);
            throw e;
        } finally {
            session.release();
        }
    }

    private Map<String, Object> transferChallenge(RemoteSession session, TransferApproval transfer, String sdkOutput) {
        try {
            InitiateTransferResponse response = transferService.initiateTransfer(
                    withSdkOutput(transfer.request(), sdkOutput), transfer.paymentInstrumentId(), transfer.recipientCountry());
            if (response.getAuthParam1() != null) {
                return challenge(response.getAuthParam1());
            }
            return completed(session, Map.of("status", "success"));
        } catch (HttpClientErrorException e) {
            String challenge = e.getStatusCode().value() == 401 ? ScaChallenges.authParam1(e) : null;
            if (challenge == null) {
                throw e;
            }
            return challenge(challenge);
        }
    }

    private Map<String, Object> batchChallenge(RemoteSession session, BatchApproval batch, String sdkOutput) {
        try {
            return completed(session, transferService.approveTransfers(batch.transferIds(), sdkOutput));
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode().value() == 422 && e.getResponseBodyAsString().contains("Transfer not found")) {
                throw new BadRequestException("Some transfers are still being created. Wait about a minute and try again.");
            }
            String challenge = e.getStatusCode().value() == 401 ? ScaChallenges.authParam1(e) : null;
            if (challenge == null) {
                throw e;
            }
            return challenge(challenge);
        }
    }

    private static Map<String, Object> challenge(String authParam1) {
        if (authParam1 == null || authParam1.isBlank()) {
            throw new BadRequestException("Adyen didn't return the authentication challenge. Try again.");
        }
        return Map.of("status", "sca_required", "authParam1", authParam1);
    }

    private Map<String, Object> completed(RemoteSession session, Object result) {
        session.complete(store.now(), result);
        return Map.of("status", Status.COMPLETED.value());
    }

    private static ConflictException notActive(RemoteSession session) {
        if (session.isBusy()) {
            return new ConflictException("The phone is already handling this request. Wait a moment.");
        }
        return new ConflictException(switch (session.getStatus()) {
            case COMPLETED -> "This request has already been completed.";
            case DECLINED -> "This request was declined.";
            case CANCELLED -> "This request was cancelled on the computer.";
            case EXPIRED -> "This request has expired. Start again on your computer.";
            default -> "Open the link again to continue.";
        });
    }

    private static void requireRegistered(RemoteSession session, Pairing pairing) {
        if (!session.isDeviceRegistered() || pairing.virtualPi() == null) {
            throw new BadRequestException("Register the phone first.");
        }
    }

    // ---- Sessions ----

    private RemoteSession sessionForUser(String sessionId, String userId) {
        findUser(userId);
        return store.findForUser(sessionId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("This request no longer exists. Start again."));
    }

    private RemoteSession sessionForPhone(String token) {
        RemoteSession session = store.findByToken(token)
                .orElseThrow(() -> new ResourceNotFoundException("This link is no longer valid. Start again on your computer."));
        ApiLogContext.setUserId(session.getUserId());
        return session;
    }

    private static <T extends Operation> T operation(RemoteSession session, Class<T> type) {
        if (!type.isInstance(session.getOperation())) {
            throw new BadRequestException("This link is for another request.");
        }
        return type.cast(session.getOperation());
    }

    private static Operation approvalOperation(RemoteSession session) {
        if (session.getOperation() instanceof Pairing) {
            throw new BadRequestException("This link is for the registration of a phone.");
        }
        return session.getOperation();
    }

    private Map<String, Object> computerView(RemoteSessionStore.Created created) {
        return computerView(created.session(), created.token());
    }

    private Map<String, Object> computerView(RemoteSession session, String token) {
        Instant now = store.now();
        Status status = session.refresh(now);
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", session.getId());
        view.put("type", session.getType().value());
        view.put("status", status.value());
        view.put("secondsLeft", session.secondsLeft(now));
        view.put("phoneLabel", session.getPhoneLabel());
        view.put("phonePasskeys", session.getPhonePasskeys());
        view.put("message", session.getMessage());
        view.put("summary", session.getSummary());
        if (status == Status.COMPLETED) {
            view.put("result", session.getResult());
        }
        if (token != null) {
            view.put("token", token);
        }
        return view;
    }

    /** With the account, for the phone to show whose request it is. */
    private Map<String, Object> phoneView(RemoteSession session, boolean withAccount) {
        Instant now = store.now();
        Status status = session.refresh(now);
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("type", session.getType().value());
        view.put("status", status.value());
        view.put("secondsLeft", session.secondsLeft(now));
        if (withAccount) {
            view.put("summary", session.getSummary());
            userRepository.findById(session.getUserId()).ifPresent(user -> {
                view.put("accountName", user.getLegalEntityName());
                view.put("maskedEmail", EmailMask.mask(user.getEmail()));
            });
            brandingRepository.findById(session.getUserId()).ifPresent(branding -> {
                view.put("platformName", branding.getPlatformName());
                view.put("logoData", branding.getLogoData());
            });
        }
        return view;
    }

    // ---- Operations ----

    private User findUser(String userId) {
        if (userId == null || userId.isBlank()) {
            throw new BadRequestException("userId is required");
        }
        ApiLogContext.setUserId(userId);
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private static String requireAccountHolder(User user) {
        if (user.getAccountHolderId() == null) {
            throw new BadRequestException("User has no account holder");
        }
        return user.getAccountHolderId();
    }

    /** The SDK output is base64 and goes into an HTTP header sent to Adyen. */
    private static String requireSdkOutput(PhoneStepRequest request) {
        String sdkOutput = request.sdkOutput() != null ? request.sdkOutput().trim() : "";
        if (!SDK_OUTPUT.matcher(sdkOutput).matches()) {
            throw new BadRequestException("The phone's authentication data is missing or invalid.");
        }
        return sdkOutput;
    }

    private static TransferRequest withSdkOutput(TransferRequest source, String sdkOutput) {
        TransferRequest copy = new TransferRequest();
        copy.setSdkOutput(sdkOutput);
        copy.setAmount(source.getAmount());
        copy.setReference(source.getReference());
        copy.setDescription(source.getDescription());
        copy.setUserId(source.getUserId());
        copy.setTransferType(source.getTransferType());
        copy.setCounterpartyCountry(source.getCounterpartyCountry());
        copy.setAccountNumber(source.getAccountNumber());
        copy.setSortCode(source.getSortCode());
        copy.setIban(source.getIban());
        copy.setRoutingNumber(source.getRoutingNumber());
        copy.setCounterpartyName(source.getCounterpartyName());
        return copy;
    }

    private static Map<String, Object> transferSummary(TransferRequest transfer, RecipientCountry recipientCountry) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("amount", transfer.getAmount());
        summary.put("currency", recipientCountry.getCurrency());
        summary.put("counterpartyName", transfer.getCounterpartyName());
        summary.put("counterpartyCountry", recipientCountry.getCountryCode());
        summary.put("bankAccount", switch (Objects.requireNonNullElse(recipientCountry.getBankAccountFormat(), "")) {
            case "iban" -> bankAccount(transfer.getIban(), null, null, null);
            case "accountNumberRoutingNumber" -> bankAccount(null, transfer.getAccountNumber(), null, transfer.getRoutingNumber());
            case "accountNumberSortCode" -> bankAccount(null, transfer.getAccountNumber(), transfer.getSortCode(), null);
            default -> Map.of();
        });
        summary.put("priority", transfer.getTransferType());
        summary.put("reference", transfer.getReference());
        summary.put("description", transfer.getDescription());
        return summary;
    }

    private static Map<String, Object> standingOrderSummary(Map<String, Object> standingOrder) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("amount", at(standingOrder, "amount", "value"));
        summary.put("currency", at(standingOrder, "amount", "currency"));
        summary.put("counterpartyName", at(standingOrder, "counterparty", "bankAccount", "accountHolder", "fullName"));
        Object account = at(standingOrder, "counterparty", "bankAccount", "accountIdentification");
        summary.put("bankAccount", account instanceof Map<?, ?> identification
                ? bankAccount(identification.get("iban"), identification.get("accountNumber"),
                identification.get("sortCode"), identification.get("routingNumber"))
                : Map.of());
        summary.put("schedule", standingOrder.get("schedule"));
        Object priorities = standingOrder.get("priorities");
        summary.put("priority", priorities instanceof List<?> list && !list.isEmpty() ? list.get(0) : null);
        summary.put("reference", standingOrder.get("reference"));
        summary.put("description", standingOrder.get("description"));
        return summary;
    }

    private static Map<String, Object> batchSummary(List<Map<String, Object>> details) {
        Map<String, Long> totals = new LinkedHashMap<>();
        List<Map<String, Object>> transfers = new ArrayList<>();
        for (Map<String, Object> detail : details) {
            if (detail.get("currency") instanceof String currency && detail.get("amount") instanceof Number amount) {
                totals.merge(currency, amount.longValue(), Long::sum);
            }
            Map<String, Object> transfer = new LinkedHashMap<>();
            transfer.put("counterpartyName", detail.get("counterpartyName"));
            transfer.put("amount", detail.get("amount"));
            transfer.put("currency", detail.get("currency"));
            transfer.put("reference", detail.get("reference"));
            transfers.add(transfer);
        }
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("count", transfers.size());
        summary.put("transfers", transfers);
        summary.put("totals", totals.entrySet().stream()
                .map(total -> Map.<String, Object>of("currency", total.getKey(), "amount", total.getValue()))
                .toList());
        return summary;
    }

    private static Map<String, Object> bankAccount(Object iban, Object accountNumber, Object sortCode, Object routingNumber) {
        Map<String, Object> account = new LinkedHashMap<>();
        putText(account, "iban", iban);
        putText(account, "accountNumber", accountNumber);
        putText(account, "sortCode", sortCode);
        putText(account, "routingNumber", routingNumber);
        return account;
    }

    private static void putText(Map<String, Object> map, String key, Object value) {
        if (value instanceof String text && !text.isBlank()) {
            map.put(key, text);
        }
    }

    private static Object at(Map<String, Object> map, String... path) {
        Object current = map;
        for (String key : path) {
            if (!(current instanceof Map<?, ?> level)) {
                return null;
            }
            current = level.get(key);
        }
        return current;
    }

    /** "My iPhone" for a phone that opened the link as "iPhone · Safari"; the phone page shows the same name. */
    private static String defaultDeviceName(String phoneLabel) {
        if (phoneLabel == null || phoneLabel.isBlank()) {
            return "My phone";
        }
        return truncate("My " + phoneLabel.split(" · ")[0].trim());
    }

    private static String truncate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() > MAX_LABEL_LENGTH ? trimmed.substring(0, MAX_LABEL_LENGTH) : trimmed;
    }
}
