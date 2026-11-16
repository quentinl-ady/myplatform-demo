package com.myplatform.demo.util;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ReceiptsTest {

    private static final int MAX = 2 * 1024 * 1024;

    @Test
    void aPdfIsRecognisedFromItsContentWhetherSentAsADataUrlOrInBase64() {
        byte[] pdf = "%PDF-1.7\n%\u00e2\u00e3\n".getBytes(StandardCharsets.ISO_8859_1);
        String base64 = Base64.getEncoder().encodeToString(pdf);

        Receipts.Receipt receipt = Receipts.decode("March dinner.pdf", "data:application/octet-stream;base64," + base64,
                MAX);

        assertThat(receipt.contentType()).isEqualTo("application/pdf");
        assertThat(receipt.fileName()).isEqualTo("March dinner.pdf");
        assertThat(receipt.size()).isEqualTo(pdf.length);
        assertThat(receipt.base64()).isEqualTo(base64);
        assertThat(Receipts.decode(null, base64, MAX).fileName()).isEqualTo("receipt.pdf");
    }

    @Test
    void imagesAreRecognisedByTheirSignature() {
        assertThat(Receipts.contentType(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0}))
                .isEqualTo("image/png");
        assertThat(Receipts.contentType(new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0}))
                .isEqualTo("image/jpeg");
        assertThat(Receipts.contentType("GIF89a....".getBytes(StandardCharsets.US_ASCII))).isEqualTo("image/gif");
        assertThat(Receipts.contentType("RIFF\0\0\0\0WEBPVP8 ".getBytes(StandardCharsets.US_ASCII)))
                .isEqualTo("image/webp");
        assertThat(Receipts.contentType("<svg onload=alert(1)>".getBytes(StandardCharsets.US_ASCII))).isNull();
    }

    @Test
    void aFileThatIsMissingUnreadableTooLargeOrOfAnotherTypeIsRejected() {
        String svg = Base64.getEncoder().encodeToString("<svg onload=alert(1)>".getBytes(StandardCharsets.UTF_8));
        byte[] large = new byte[1_025];
        System.arraycopy("%PDF-".getBytes(StandardCharsets.US_ASCII), 0, large, 0, 5);

        assertThatThrownBy(() -> Receipts.decode("x.pdf", " ", MAX))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Choose a receipt: a PDF or an image.");
        assertThatThrownBy(() -> Receipts.decode("x.pdf", "data:text/plain,hello", MAX))
                .hasMessage("The receipt couldn't be read. Choose it again.");
        assertThatThrownBy(() -> Receipts.decode("x.pdf", "not base64!", MAX))
                .hasMessage("The receipt couldn't be read. Choose it again.");
        assertThatThrownBy(() -> Receipts.decode("x.svg", svg, MAX))
                .hasMessage("The receipt must be a PDF or an image: PNG, JPEG, GIF or WebP.");
        assertThatThrownBy(() -> Receipts.decode("big.pdf", Base64.getEncoder().encodeToString(large), 1_024))
                .hasMessage("The receipt is larger than 1 KB. Choose a smaller file.");
        assertThatThrownBy(() -> Receipts.decode("big.pdf", "A".repeat(MAX * 2 + 4), MAX))
                .hasMessage("The receipt is larger than 2 MB. Choose a smaller file.");
    }

    @Test
    void theFileNameLosesItsFoldersAndTheCharactersAFileNameCantHave() {
        assertThat(Receipts.fileName("C:\\Users\\me\\Desktop\\ticket<1>.jpg", Receipts.JPEG)).isEqualTo("ticket1.jpg");
        assertThat(Receipts.fileName("../../taxi.png", Receipts.PNG)).isEqualTo("taxi.png");
        assertThat(Receipts.fileName("..", Receipts.PNG)).isEqualTo("receipt.png");
        assertThat(Receipts.fileName("a".repeat(200) + ".pdf", Receipts.PDF)).hasSize(120).endsWith("a.pdf");
    }
}
