package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.AccountStatementDTO;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.AccountStatement;
import com.myplatform.demo.model.User;
import com.myplatform.demo.model.UserBranding;
import com.myplatform.demo.repository.AccountStatementRepository;
import com.myplatform.demo.repository.UserBrandingRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.AccountStatementFile;
import com.myplatform.demo.util.CamtStatement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Account statements of the business accounts. Adyen announces each new CAMT.053 statement with the
 * balancePlatform.report.created webhook. When a user asks for it, the backend downloads the file with the
 * report user and turns it into a PDF, so the browser never sees the Adyen URL or the credentials.
 */
@Service
public class AccountStatementService {

    private static final Logger log = LoggerFactory.getLogger(AccountStatementService.class);
    private static final String REPORT_CREATED = "balancePlatform.report.created";
    /** The webhook signature isn't checked: only Adyen URLs are kept, so the credentials can't be sent elsewhere. */
    private static final Pattern ADYEN_HOST = Pattern.compile("balanceplatform(-api)?-(test|live)\\.adyen\\.com");
    private static final Pattern FILE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,200}");
    /** Latest period first, then the currencies of a period in alphabetical order. */
    private static final Comparator<AccountStatementDTO> LATEST_FIRST = Comparator
            .comparing(AccountStatementDTO::periodEnd, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(AccountStatementDTO::currency, Comparator.nullsLast(Comparator.naturalOrder()));

    /** The frontend shows the same name when the user hasn't set one. */
    private static final String DEFAULT_PLATFORM_NAME = "My Platform";
    /** Adyen requires a support contact on the statements: this demo has no support desk, so it shows placeholders. */
    private static final String SUPPORT_EMAIL = "support@myplatform.example";
    private static final String SUPPORT_PHONE = "+31 20 000 0000";

    private final AccountStatementRepository statementRepository;
    private final UserRepository userRepository;
    private final UserBrandingRepository brandingRepository;
    private final LegalEntityService legalEntityService;
    private final AccountStatementPdfService pdfService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String reportUser;
    private final String reportPassword;
    private final String frontendUrl;

    /** A statement as a PDF, and the name to save it under. */
    public record StatementPdf(byte[] content, String fileName) {
    }

    public AccountStatementService(AccountStatementRepository statementRepository,
                                   UserRepository userRepository,
                                   UserBrandingRepository brandingRepository,
                                   LegalEntityService legalEntityService,
                                   AccountStatementPdfService pdfService,
                                   RestTemplate restTemplate,
                                   ObjectMapper objectMapper,
                                   @Value("${adyen.report.user:}") String reportUser,
                                   @Value("${adyen.report.password:}") String reportPassword,
                                   @Value("${app.frontend.url}") String frontendUrl) {
        this.statementRepository = statementRepository;
        this.userRepository = userRepository;
        this.brandingRepository = brandingRepository;
        this.legalEntityService = legalEntityService;
        this.pdfService = pdfService;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.reportUser = reportUser;
        this.reportPassword = reportPassword;
        this.frontendUrl = frontendUrl;
    }

    /** Records the statement announced by a report webhook. Never throws: Adyen must still get its [accepted]. */
    public void applyWebhook(String rawJson) {
        try {
            JsonNode root = objectMapper.readTree(rawJson);
            if (!REPORT_CREATED.equals(text(root, "type"))) {
                return;
            }
            JsonNode data = root.path("data");
            String fileName = text(data, "fileName");
            String downloadUrl = text(data, "downloadUrl");
            if (!AccountStatementFile.isStatement(fileName, downloadUrl)) {
                return; // another report of the balance platform
            }
            String accountHolderId = text(data.path("accountHolder"), "id");
            String balanceAccountId = text(data.path("balanceAccount"), "id");
            if (fileName == null || !FILE_NAME.matcher(fileName).matches() || !isAdyenDownloadUrl(downloadUrl)
                    || accountHolderId == null || balanceAccountId == null) {
                log.warn("Account statement webhook ignored: unexpected file name, download URL or account");
                return;
            }
            if (statementRepository.existsById(fileName)) {
                return; // Adyen sends the webhook again until it gets [accepted]
            }
            if (userRepository.findByAccountHolderId(accountHolderId).isEmpty()) {
                log.info("Account statement {} ignored: account holder {} isn't linked to a user", fileName, accountHolderId);
                return;
            }
            AccountStatement statement = new AccountStatement();
            statement.setFileName(fileName);
            statement.setAccountHolderId(accountHolderId);
            statement.setBalanceAccountId(balanceAccountId);
            statement.setDownloadUrl(downloadUrl);
            statement.setCreationDate(creationDate(text(data, "creationDate")));
            statementRepository.save(statement);
            log.info("Account statement {} recorded for account holder {}", fileName, accountHolderId);
        } catch (Exception e) {
            log.warn("Couldn't record the account statement webhook: {}", e.getMessage());
        }
    }

    /** The latest statements of the user's account holder. */
    public List<AccountStatementDTO> getStatements(String userId) {
        String accountHolderId = user(userId).getAccountHolderId();
        if (accountHolderId == null) {
            return List.of();
        }
        return statementRepository.findTop10ByAccountHolderIdOrderByCreationDateDesc(accountHolderId).stream()
                .map(AccountStatementDTO::of)
                .sorted(LATEST_FIRST)
                .toList();
    }

    /**
     * The statement as a PDF, built from the CAMT.053 file Adyen generated, with the account holder as Adyen
     * verified it and the branding of the platform. A user only gets the statements of their account holder.
     */
    public StatementPdf downloadPdf(String userId, String fileName) {
        User user = user(userId);
        byte[] xml = downloadXml(user, fileName);
        CamtStatement camt;
        try {
            camt = CamtStatement.parse(xml);
        } catch (IllegalArgumentException e) {
            log.warn("Couldn't read the account statement {}: {}", fileName, e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Adyen sent this statement in a format that couldn't be read.");
        }
        try {
            return new StatementPdf(pdfService.render(camt, holder(user, camt), platform(user.getId())),
                    AccountStatementFile.pdfName(fileName));
        } catch (RuntimeException e) {
            log.error("Couldn't create the PDF of the account statement {}", fileName, e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Couldn't create the PDF of this statement.");
        }
    }

    /**
     * The account holder as Adyen verified it: from its legal entity, else as the statement names it,
     * else the name the user signed up with.
     */
    private LegalEntityService.Identity holder(User user, CamtStatement camt) {
        if (user.getLegalEntityId() != null) {
            try {
                LegalEntityService.Identity identity = legalEntityService.getIdentity(user.getLegalEntityId());
                if (identity != null) {
                    return identity;
                }
            } catch (Exception e) {
                log.warn("Statement of user {} created without the legal entity details: {}", user.getId(), e.getMessage());
            }
        }
        if (camt.recipient() != null) {
            return new LegalEntityService.Identity(camt.recipient().name(), null, camt.recipient().address());
        }
        String name = user.getLegalEntityName() != null && !user.getLegalEntityName().isBlank()
                ? user.getLegalEntityName().trim()
                : (Objects.toString(user.getFirstName(), "") + " " + Objects.toString(user.getLastName(), "")).trim();
        return new LegalEntityService.Identity(name, null, List.of());
    }

    private AccountStatementPdfService.Platform platform(String userId) {
        UserBranding branding = brandingRepository.findById(userId).orElse(null);
        String name = branding != null && branding.getPlatformName() != null && !branding.getPlatformName().isBlank()
                ? branding.getPlatformName().trim()
                : DEFAULT_PLATFORM_NAME;
        return new AccountStatementPdfService.Platform(name, frontendUrl.replaceAll("/+$", ""), SUPPORT_EMAIL,
                SUPPORT_PHONE, branding != null ? branding.getLogoData() : null);
    }

    /** The file as Adyen generated it. */
    private byte[] downloadXml(User user, String fileName) {
        String accountHolderId = user.getAccountHolderId();
        AccountStatement statement = accountHolderId == null ? null
                : statementRepository.findByFileNameAndAccountHolderId(fileName, accountHolderId)
                        .filter(s -> isAdyenDownloadUrl(s.getDownloadUrl()))
                        .orElse(null);
        if (statement == null) {
            throw new ResourceNotFoundException("Statement not found");
        }
        if (reportUser.isBlank() || reportPassword.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Statement downloads aren't set up on this server: adyen.report.user and adyen.report.password are missing.");
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(reportUser, reportPassword, StandardCharsets.UTF_8);
        try {
            byte[] file = restTemplate.exchange(URI.create(statement.getDownloadUrl()), HttpMethod.GET,
                    new HttpEntity<>(headers), byte[].class).getBody();
            return file != null ? file : new byte[0];
        } catch (HttpClientErrorException.NotFound e) {
            throw new ResourceNotFoundException("Adyen no longer has this statement.");
        } catch (HttpClientErrorException.Unauthorized | HttpClientErrorException.Forbidden e) {
            log.warn("Adyen refused the report user for {}: HTTP {}", fileName, e.getStatusCode().value());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Adyen refused the report credentials: check adyen.report.user and adyen.report.password.");
        } catch (HttpStatusCodeException e) {
            // Adyen also answers 500 for a statement it doesn't have.
            log.warn("Adyen couldn't send the statement {}: HTTP {}", fileName, e.getStatusCode().value());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Adyen couldn't send this statement (HTTP " + e.getStatusCode().value() + "). Try again later.");
        }
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private static boolean isAdyenDownloadUrl(String url) {
        if (url == null) return false;
        try {
            URI uri = new URI(url);
            return "https".equals(uri.getScheme())
                    && uri.getHost() != null && ADYEN_HOST.matcher(uri.getHost()).matches()
                    && uri.getPort() == -1 && uri.getRawUserInfo() == null
                    && uri.getRawPath() != null && uri.getRawPath().startsWith("/balanceplatform/reportDownload/");
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static Instant creationDate(String value) {
        if (value == null) return Instant.now();
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException e) {
            return Instant.now();
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node != null ? node.get(field) : null;
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }
}
