package com.myplatform.demo.util;

import com.itextpdf.io.image.ImageDataFactory;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.layout.element.Image;
import com.itextpdf.styledxmlparser.resolver.resource.IResourceRetriever;
import com.itextpdf.svg.converter.SvgConverter;
import com.itextpdf.svg.processors.impl.SvgConverterProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Base64;
import java.util.Map;

/** What the PDFs of the platform share: its logo, and text the standard fonts can draw. */
public final class PdfSupport {

    private static final Logger log = LoggerFactory.getLogger(PdfSupport.class);

    /** The same default logo as the frontend. */
    private static final String DEFAULT_LOGO = "/default-platform-logo.svg";
    /** Letters that Unicode doesn't split into a base letter and an accent. */
    private static final Map<Character, String> UNDECOMPOSABLE = Map.of(
            'Ł', "L", 'ł', "l", 'Đ', "D", 'đ', "d", 'Ħ', "H", 'ħ', "h", 'ı', "i");

    /** A logo is user content: its SVG must not make the server fetch anything. */
    private static final IResourceRetriever OFFLINE = new IResourceRetriever() {
        @Override
        public InputStream getInputStreamByUrl(URL url) {
            return null;
        }

        @Override
        public byte[] getByteArrayByUrl(URL url) {
            return null;
        }
    };

    private PdfSupport() {
    }

    /**
     * The branding logo, or the default one when the platform has none; null when it can't be drawn.
     *
     * @param logoDataUrl the logo of the branding, a data URL
     * @param document    names the PDF in the log, e.g. "Statement PDF"
     */
    public static Image logo(PdfDocument pdf, String logoDataUrl, String document) {
        try {
            if (logoDataUrl == null || logoDataUrl.isBlank()) {
                try (InputStream in = PdfSupport.class.getResourceAsStream(DEFAULT_LOGO)) {
                    return in != null ? svg(pdf, in) : null;
                }
            }
            byte[] bytes = decode(logoDataUrl);
            if (isSvg(bytes)) {
                return svg(pdf, new ByteArrayInputStream(bytes));
            }
            if (!ImageDataFactory.isSupportedType(bytes)) {
                log.warn("{} created without the platform logo: unsupported image format", document);
                return null;
            }
            return new Image(ImageDataFactory.create(bytes));
        } catch (Exception e) {
            log.warn("{} created without the platform logo: {}", document, e.getMessage());
            return null;
        }
    }

    /** The standard fonts draw Western European text: other letters lose their accent, or become "?". */
    public static String clean(PdfFont font, String value) {
        if (value == null) {
            return "";
        }
        StringBuilder text = new StringBuilder(value.length());
        value.codePoints().forEach(codePoint -> {
            if (Character.isWhitespace(codePoint) || Character.isISOControl(codePoint)) {
                text.append(' ');
            } else if (font.containsGlyph(codePoint)) {
                text.appendCodePoint(codePoint);
            } else {
                text.append(replacement(font, codePoint));
            }
        });
        return text.toString();
    }

    private static String replacement(PdfFont font, int codePoint) {
        String replacement = codePoint <= Character.MAX_VALUE ? UNDECOMPOSABLE.get((char) codePoint) : null;
        if (replacement == null) {
            replacement = Normalizer.normalize(new String(Character.toChars(codePoint)), Normalizer.Form.NFD)
                    .replaceAll("\\p{M}", "");
        }
        return !replacement.isEmpty() && replacement.codePoints().allMatch(font::containsGlyph) ? replacement : "?";
    }

    private static Image svg(PdfDocument pdf, InputStream in) throws IOException {
        return new Image(SvgConverter.convertToXObject(in, pdf, new SvgConverterProperties().setResourceRetriever(OFFLINE)));
    }

    /** Branding logos are data URLs, e.g. data:image/png;base64,iVBOR... */
    private static byte[] decode(String dataUrl) {
        String value = dataUrl.trim();
        int comma = value.indexOf(',');
        if (!value.startsWith("data:") || comma < 0) {
            return Base64.getMimeDecoder().decode(value);
        }
        String data = value.substring(comma + 1);
        return value.substring(0, comma).endsWith(";base64")
                ? Base64.getMimeDecoder().decode(data)
                : URLDecoder.decode(data, StandardCharsets.UTF_8).getBytes(StandardCharsets.UTF_8);
    }

    private static boolean isSvg(byte[] bytes) {
        return new String(bytes, 0, Math.min(bytes.length, 2048), StandardCharsets.UTF_8).contains("<svg");
    }
}
