package com.myplatform.demo.util;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Receipts the user adds to their card expenses: a PDF or an image, recognised from its content rather than from what
 * the browser says it is.
 */
public final class Receipts {

    public static final String PDF = "application/pdf";
    public static final String PNG = "image/png";
    public static final String JPEG = "image/jpeg";
    public static final String GIF = "image/gif";
    public static final String WEBP = "image/webp";
    public static final List<String> TYPES = List.of(PDF, PNG, JPEG, GIF, WEBP);

    private static final int MAX_NAME = 120;
    private static final Pattern UNSAFE_NAME = Pattern.compile("[\\p{Cntrl}\"\\\\/:*?<>|]");
    private static final byte[] PNG_SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    private static final byte[] JPEG_SIGNATURE = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};

    /** @param base64 the file, encoded again so that it holds no line breaks or data URL prefix */
    public record Receipt(String fileName, String contentType, int size, String base64) {
    }

    private Receipts() {
    }

    /**
     * Reads a receipt the browser sent in base64, or as a data URL.
     *
     * @throws IllegalArgumentException with a message for people, when the file is missing, too large or of another type
     */
    public static Receipt decode(String fileName, String data, int maxBytes) {
        if (data == null || data.isBlank()) {
            throw new IllegalArgumentException("Choose a receipt: a PDF or an image.");
        }
        String base64 = data.trim();
        if (base64.startsWith("data:")) {
            int comma = base64.indexOf(',');
            if (comma < 0 || !base64.substring(0, comma).endsWith(";base64")) {
                throw new IllegalArgumentException("The receipt couldn't be read. Choose it again.");
            }
            base64 = base64.substring(comma + 1);
        }
        String tooLarge = "The receipt is larger than " + megabytes(maxBytes) + ". Choose a smaller file.";
        // 4 characters of base64 encode 3 bytes: a text twice as long as the largest file is rejected before it's decoded.
        if (base64.length() > maxBytes * 2L) {
            throw new IllegalArgumentException(tooLarge);
        }
        byte[] bytes;
        try {
            bytes = Base64.getMimeDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("The receipt couldn't be read. Choose it again.");
        }
        if (bytes.length == 0) {
            throw new IllegalArgumentException("The receipt is empty.");
        }
        if (bytes.length > maxBytes) {
            throw new IllegalArgumentException(tooLarge);
        }
        String type = contentType(bytes);
        if (type == null) {
            throw new IllegalArgumentException("The receipt must be a PDF or an image: PNG, JPEG, GIF or WebP.");
        }
        return new Receipt(fileName(fileName, type), type, bytes.length, Base64.getEncoder().encodeToString(bytes));
    }

    /** The type the file's first bytes tell, null for a type that isn't accepted. */
    static String contentType(byte[] bytes) {
        if (startsWith(bytes, "%PDF-".getBytes(StandardCharsets.US_ASCII))) {
            return PDF;
        }
        if (startsWith(bytes, PNG_SIGNATURE)) {
            return PNG;
        }
        if (startsWith(bytes, JPEG_SIGNATURE)) {
            return JPEG;
        }
        if (startsWith(bytes, "GIF87a".getBytes(StandardCharsets.US_ASCII))
                || startsWith(bytes, "GIF89a".getBytes(StandardCharsets.US_ASCII))) {
            return GIF;
        }
        if (bytes.length >= 12 && startsWith(bytes, "RIFF".getBytes(StandardCharsets.US_ASCII))
                && "WEBP".equals(new String(bytes, 8, 4, StandardCharsets.US_ASCII))) {
            return WEBP;
        }
        return null;
    }

    /** The name without its folders and the characters a file name can't have; receipt.pdf when nothing is left. */
    static String fileName(String name, String type) {
        String extension = switch (type) {
            case PDF -> ".pdf";
            case PNG -> ".png";
            case JPEG -> ".jpg";
            case GIF -> ".gif";
            default -> ".webp";
        };
        String base = name == null ? "" : name;
        base = base.substring(Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\')) + 1);
        base = UNSAFE_NAME.matcher(base).replaceAll("").trim();
        if (base.isEmpty() || base.chars().allMatch(c -> c == '.')) {
            return "receipt" + extension;
        }
        if (base.length() > MAX_NAME) {
            int dot = base.lastIndexOf('.');
            String suffix = dot > 0 && base.length() - dot <= 6 ? base.substring(dot) : "";
            base = base.substring(0, MAX_NAME - suffix.length()).trim() + suffix;
        }
        return base;
    }

    private static boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (bytes[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static String megabytes(int bytes) {
        return bytes % (1024 * 1024) == 0 ? bytes / (1024 * 1024) + " MB" : (bytes / 1024) + " KB";
    }
}
