package com.myplatform.demo.service;

import com.myplatform.demo.model.RemoteSession;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory sessions between a computer and a phone. The phone proves it scanned the QR code with
 * a random token carried by the link; only its SHA-256 hash is kept.
 */
@Component
public class RemoteSessionStore {

    /** Time to scan the QR code, then to finish on the phone after each step. */
    public static final Duration WINDOW = Duration.ofMinutes(5);
    /** Ended sessions stay readable this long, for the computer to show the outcome. */
    private static final Duration RETENTION = Duration.ofMinutes(15);
    private static final SecureRandom RANDOM = new SecureRandom();

    public record Created(RemoteSession session, String token) {
    }

    private final Clock clock;
    private final Map<String, RemoteSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, String> sessionIdByTokenHash = new ConcurrentHashMap<>();

    public RemoteSessionStore() {
        this(Clock.systemUTC());
    }

    RemoteSessionStore(Clock clock) {
        this.clock = clock;
    }

    public Instant now() {
        return clock.instant();
    }

    /** The sessions of the user still running are cancelled: a phone handles one request at a time. */
    public Created create(RemoteSession.Type type, String userId, RemoteSession.Operation operation,
                          Map<String, Object> summary) {
        Instant now = now();
        sessions.values().stream()
                .filter(session -> session.getUserId().equals(userId))
                .forEach(session -> session.end(now, RemoteSession.Status.CANCELLED));

        String token = randomToken();
        String tokenHash = hash(token);
        RemoteSession session = new RemoteSession(UUID.randomUUID().toString(), tokenHash, type, userId,
                operation, summary, now, WINDOW);
        sessions.put(session.getId(), session);
        sessionIdByTokenHash.put(tokenHash, session.getId());
        return new Created(session, token);
    }

    public Optional<RemoteSession> findForUser(String sessionId, String userId) {
        RemoteSession session = sessionId != null ? sessions.get(sessionId) : null;
        if (session == null || !session.getUserId().equals(userId)) {
            return Optional.empty();
        }
        session.refresh(now());
        return Optional.of(session);
    }

    public Optional<RemoteSession> findByToken(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        String sessionId = sessionIdByTokenHash.get(hash(token.trim()));
        RemoteSession session = sessionId != null ? sessions.get(sessionId) : null;
        if (session != null) {
            session.refresh(now());
        }
        return Optional.ofNullable(session);
    }

    @Scheduled(fixedDelay = 60_000)
    public void purge() {
        Instant now = now();
        sessions.values().removeIf(session -> {
            boolean stale = session.refresh(now).isFinal() && session.getUpdatedAt().plus(RETENTION).isBefore(now);
            if (stale) {
                sessionIdByTokenHash.remove(session.getTokenHash());
            }
            return stale;
        });
    }

    int size() {
        return sessions.size();
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
