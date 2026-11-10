package com.myplatform.demo.service;

import com.itextpdf.barcodes.BarcodeQRCode;
import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.kernel.colors.DeviceRgb;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.pdf.action.PdfAction;
import com.itextpdf.kernel.pdf.canvas.draw.SolidLine;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.borders.Border;
import com.itextpdf.layout.borders.SolidBorder;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.element.Div;
import com.itextpdf.layout.element.IBlockElement;
import com.itextpdf.layout.element.Image;
import com.itextpdf.layout.element.LineSeparator;
import com.itextpdf.layout.element.Link;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.properties.BorderRadius;
import com.itextpdf.layout.properties.HorizontalAlignment;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;
import com.itextpdf.layout.properties.VerticalAlignment;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.util.PaymentMethodNames;
import com.myplatform.demo.util.PdfSupport;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

/**
 * The PDF of a customer invoice: the seller and the customer, the lines with their VAT, the totals and, while the
 * invoice is open, a Pay now button and a QR code that open its Adyen payment link.
 */
@Service
public class InvoicePdfService {

    private static final DeviceRgb INK = new DeviceRgb(17, 24, 39);
    private static final DeviceRgb WHITE = new DeviceRgb(255, 255, 255);
    private static final DeviceRgb SOFT = new DeviceRgb(55, 65, 81);
    private static final DeviceRgb MUTED = new DeviceRgb(107, 114, 128);
    private static final DeviceRgb RULE = new DeviceRgb(229, 231, 235);
    private static final DeviceRgb PANEL = new DeviceRgb(243, 244, 246);
    private static final DeviceRgb GREEN_INK = new DeviceRgb(6, 95, 70);
    private static final DeviceRgb GREEN_PANEL = new DeviceRgb(236, 253, 245);
    private static final DeviceRgb GREEN_RULE = new DeviceRgb(110, 231, 183);
    private static final DeviceRgb RED_INK = new DeviceRgb(153, 27, 27);
    private static final DeviceRgb RED_PANEL = new DeviceRgb(254, 242, 242);
    private static final DeviceRgb RED_RULE = new DeviceRgb(252, 165, 165);
    private static final float MARGIN = 40;
    private static final float BOTTOM_MARGIN = 52;
    private static final float FOOTER_Y = 24;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    public byte[] render(InvoiceDTO invoice, LegalEntityService.Identity seller,
                         AccountStatementPdfService.Platform platform, String taxLabel) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PdfDocument pdf = new PdfDocument(new PdfWriter(out));
        try (Document document = new Document(pdf, PageSize.A4, false)) {
            new Renderer(pdf, document, invoice, seller, platform, taxLabel).render();
        } catch (IOException e) {
            throw new UncheckedIOException("Couldn't create the invoice PDF", e);
        }
        return out.toByteArray();
    }

    private static final class Renderer {

        private final PdfDocument pdf;
        private final Document document;
        private final InvoiceDTO invoice;
        private final LegalEntityService.Identity seller;
        private final AccountStatementPdfService.Platform platform;
        private final String taxLabel;
        private final PdfFont regular;
        private final PdfFont bold;

        Renderer(PdfDocument pdf, Document document, InvoiceDTO invoice, LegalEntityService.Identity seller,
                 AccountStatementPdfService.Platform platform, String taxLabel) throws IOException {
            this.pdf = pdf;
            this.document = document;
            this.invoice = invoice;
            this.seller = seller;
            this.platform = platform;
            this.taxLabel = taxLabel;
            this.regular = PdfFontFactory.createFont(StandardFonts.HELVETICA);
            this.bold = PdfFontFactory.createFont(StandardFonts.HELVETICA_BOLD);
        }

        void render() {
            pdf.getDocumentInfo()
                    .setTitle("Invoice " + invoice.number())
                    .setAuthor(clean(seller.name()))
                    .setCreator(clean(platform.name()));
            document.setMargins(MARGIN, MARGIN, BOTTOM_MARGIN, MARGIN);
            document.setFont(regular).setFontSize(9).setFontColor(INK);
            header();
            parties();
            lines();
            totals();
            payment();
            notes();
            footers();
        }

        private void header() {
            Table header = new Table(UnitValue.createPercentArray(new float[]{55, 45})).useAllAvailableWidth();
            header.addCell(plain().add(brand()).setVerticalAlignment(VerticalAlignment.MIDDLE));
            Cell title = plain().setTextAlignment(TextAlignment.RIGHT);
            title.add(paragraph("Invoice", bold, 22, INK));
            title.add(paragraph(invoice.number(), bold, 11, SOFT).setMarginTop(2));
            Table badge = statusBadge();
            if (badge != null) {
                title.add(badge);
            }
            header.addCell(title);
            document.add(header);
            document.add(rule(14));
        }

        private IBlockElement brand() {
            Paragraph name = paragraph(platform.name(), bold, 13, INK);
            Image logo = PdfSupport.logo(pdf, platform.logoDataUrl(), "Invoice PDF");
            if (logo == null) {
                return name;
            }
            Table brand = new Table(2);
            brand.addCell(plain().add(logo.scaleToFit(110, 32)).setPaddingRight(8)
                    .setVerticalAlignment(VerticalAlignment.MIDDLE));
            brand.addCell(plain().add(name).setVerticalAlignment(VerticalAlignment.MIDDLE));
            return brand;
        }

        /** Paid, void, overdue and draft invoices say so at a glance. */
        private Table statusBadge() {
            String label;
            DeviceRgb ink;
            DeviceRgb panel;
            DeviceRgb border;
            switch (invoice.status()) {
                case "PAID" -> {
                    label = "PAID";
                    ink = GREEN_INK;
                    panel = GREEN_PANEL;
                    border = GREEN_RULE;
                }
                case "OVERDUE" -> {
                    label = "OVERDUE";
                    ink = RED_INK;
                    panel = RED_PANEL;
                    border = RED_RULE;
                }
                case "VOID" -> {
                    label = "VOID";
                    ink = SOFT;
                    panel = PANEL;
                    border = RULE;
                }
                case "DRAFT" -> {
                    label = "DRAFT";
                    ink = SOFT;
                    panel = PANEL;
                    border = RULE;
                }
                default -> {
                    return null;
                }
            }
            Cell cell = new Cell().setBorder(new SolidBorder(border, 0.75f)).setBackgroundColor(panel)
                    .setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(7).setPaddingRight(7)
                    .add(paragraph(label, bold, 7.5f, ink).setCharacterSpacing(0.6f));
            return new Table(1).addCell(cell).setHorizontalAlignment(HorizontalAlignment.RIGHT).setMarginTop(6);
        }

        private void parties() {
            Table grid = new Table(UnitValue.createPercentArray(new float[]{34, 34, 32})).useAllAvailableWidth()
                    .setMarginTop(14);

            Cell from = plain().setPaddingRight(14);
            from.add(label("From"));
            from.add(paragraph(seller.name(), bold, 9.5f, INK));
            if (seller.doingBusinessAs() != null) {
                from.add(paragraph("Doing business as " + seller.doingBusinessAs(), regular, 8.5f, SOFT));
            }
            for (String line : seller.address()) {
                from.add(paragraph(line, regular, 8.5f, SOFT));
            }
            grid.addCell(from);

            InvoiceDTO.CustomerRef customer = invoice.customer();
            Cell to = plain().setPaddingRight(14);
            to.add(label("Bill to"));
            to.add(paragraph(customer.displayName(), bold, 9.5f, INK));
            if (customer.company() != null && !customer.company().isBlank() && customer.name() != null) {
                to.add(paragraph("Attn. " + customer.name(), regular, 8.5f, SOFT));
            }
            for (String line : customerAddress(customer)) {
                to.add(paragraph(line, regular, 8.5f, SOFT));
            }
            to.add(paragraph(customer.email(), regular, 8.5f, SOFT));
            if (customer.vatNumber() != null && !customer.vatNumber().isBlank()) {
                to.add(paragraph(taxLabel + " number " + customer.vatNumber(), regular, 8.5f, SOFT));
            }
            grid.addCell(to);

            Cell details = plain();
            details.add(label("Details"));
            Table facts = new Table(UnitValue.createPercentArray(new float[]{48, 52})).useAllAvailableWidth();
            fact(facts, "Issue date", day(invoice.issueDate()), false);
            fact(facts, "Due date", day(invoice.dueDate()), false);
            fact(facts, "Amount due", money(invoice.amountDue()), true);
            details.add(facts);
            grid.addCell(details);

            document.add(grid);
        }

        private void fact(Table facts, String label, String value, boolean strong) {
            facts.addCell(plain().setPaddingBottom(2).add(paragraph(label, regular, 8.5f, MUTED)));
            facts.addCell(plain().setPaddingBottom(2).setTextAlignment(TextAlignment.RIGHT)
                    .add(paragraph(value, strong ? bold : regular, strong ? 9.5f : 8.5f, INK)));
        }

        private void lines() {
            Table table = new Table(UnitValue.createPercentArray(new float[]{46, 9, 16, 10, 19}))
                    .useAllAvailableWidth().setMarginTop(20);
            columnHeader(table, "Description", TextAlignment.LEFT);
            columnHeader(table, "Qty", TextAlignment.RIGHT);
            columnHeader(table, "Unit price", TextAlignment.RIGHT);
            columnHeader(table, taxLabel, TextAlignment.RIGHT);
            columnHeader(table, "Amount", TextAlignment.RIGHT);
            for (InvoiceDTO.Line line : invoice.lines()) {
                table.addCell(row().add(paragraph(line.description(), regular, 9, INK)));
                table.addCell(row().setTextAlignment(TextAlignment.RIGHT)
                        .add(paragraph(String.valueOf(line.quantity()), regular, 9, INK)));
                table.addCell(row().setTextAlignment(TextAlignment.RIGHT)
                        .add(paragraph(number(line.unitPrice()), regular, 9, INK)));
                table.addCell(row().setTextAlignment(TextAlignment.RIGHT)
                        .add(paragraph(rate(line.vatRate()), regular, 9, SOFT)));
                table.addCell(row().setTextAlignment(TextAlignment.RIGHT)
                        .add(paragraph(number(line.netAmount()), regular, 9, INK)));
            }
            document.add(table);
        }

        private void totals() {
            Table totals = new Table(UnitValue.createPercentArray(new float[]{60, 40}))
                    .setWidth(UnitValue.createPercentValue(45)).setHorizontalAlignment(HorizontalAlignment.RIGHT)
                    .setMarginTop(8).setKeepTogether(true);
            total(totals, "Subtotal", number(invoice.subtotal()), false, null);
            for (InvoiceDTO.Vat vat : invoice.vat()) {
                total(totals, taxLabel + " " + rate(vat.rate()) + " on " + number(vat.base()), number(vat.tax()), false, null);
            }
            total(totals, "Total " + invoice.currency(), number(invoice.total()), true, new SolidBorder(INK, 0.75f));
            if ("PAID".equals(invoice.status())) {
                total(totals, "Paid" + (invoice.paidAt() != null ? " on " + day(invoice.paidAt()) : ""),
                        "-" + number(invoice.total()), false, null);
                total(totals, "Amount due", number(0), true, new SolidBorder(RULE, 0.5f));
            }
            document.add(totals);
        }

        private void total(Table totals, String label, String value, boolean strong, SolidBorder top) {
            Cell name = plain().setPaddingTop(3).setPaddingBottom(3)
                    .add(paragraph(label, strong ? bold : regular, strong ? 10 : 8.5f, strong ? INK : SOFT));
            Cell amount = plain().setPaddingTop(3).setPaddingBottom(3).setTextAlignment(TextAlignment.RIGHT)
                    .add(paragraph(value, strong ? bold : regular, strong ? 10 : 8.5f, INK));
            if (top != null) {
                name.setBorderTop(top).setPaddingTop(5);
                amount.setBorderTop(top).setPaddingTop(5);
            }
            totals.addCell(name);
            totals.addCell(amount);
        }

        private void payment() {
            InvoiceDTO.PaymentLink link = invoice.paymentLink();
            boolean open = "SENT".equals(invoice.status()) || "OVERDUE".equals(invoice.status());
            boolean linkUsable = link != null && link.url() != null && !"expired".equals(link.status())
                    && (link.expiresAt() == null || link.expiresAt().isAfter(Instant.now()));
            if (open && linkUsable) {
                payPanel(link);
            } else if ("PAID".equals(invoice.status())) {
                String method = PaymentMethodNames.of(invoice.paymentMethod());
                Div panel = panel(GREEN_PANEL, GREEN_RULE);
                panel.add(paragraph("Paid, thank you", bold, 11, GREEN_INK));
                panel.add(paragraph("Received" + (invoice.paidAt() != null ? " on " + day(invoice.paidAt()) : "")
                        + (method != null ? " by " + method : "") + ".", regular, 8.5f, GREEN_INK).setMarginTop(3));
                if (invoice.pspReference() != null) {
                    panel.add(paragraph("Payment reference " + invoice.pspReference(), regular, 7.5f, GREEN_INK).setMarginTop(2));
                }
                document.add(panel);
            } else if ("VOID".equals(invoice.status())) {
                Div panel = panel(PANEL, RULE);
                panel.add(paragraph("This invoice is void", bold, 11, INK));
                panel.add(paragraph("It was cancelled" + (invoice.voidedAt() != null ? " on " + day(invoice.voidedAt()) : "")
                        + " and can't be paid.", regular, 8.5f, SOFT).setMarginTop(3));
                document.add(panel);
            } else if ("DRAFT".equals(invoice.status())) {
                Div panel = panel(PANEL, RULE);
                panel.add(paragraph("Draft", bold, 11, INK));
                panel.add(paragraph("This invoice hasn't been sent yet. Its payment link is created when it's sent.",
                        regular, 8.5f, SOFT).setMarginTop(3));
                document.add(panel);
            } else if (open) {
                Div panel = panel(PANEL, RULE);
                panel.add(paragraph("Payment link expired", bold, 11, INK));
                panel.add(paragraph("Contact " + seller.name() + " for a new payment link.", regular, 8.5f, SOFT)
                        .setMarginTop(3));
                document.add(panel);
            }
        }

        private void payPanel(InvoiceDTO.PaymentLink link) {
            PdfAction open = PdfAction.createURI(link.url());
            Table panel = new Table(UnitValue.createPercentArray(new float[]{72, 28})).useAllAvailableWidth()
                    .setMarginTop(22).setKeepTogether(true).setBackgroundColor(PANEL)
                    .setBorderRadius(new BorderRadius(6));

            Cell text = plain().setPadding(16).setVerticalAlignment(VerticalAlignment.MIDDLE);
            text.add(label("Pay online"));
            text.add(paragraph("Pay " + money(invoice.amountDue()) + " securely in a few clicks.", bold, 11, INK));
            Cell button = new Cell().setBorder(Border.NO_BORDER).setBackgroundColor(INK)
                    .setBorderRadius(new BorderRadius(5))
                    .setPaddingTop(7).setPaddingBottom(7).setPaddingLeft(18).setPaddingRight(18)
                    .add(paragraph("Pay now", bold, 10, WHITE))
                    .setAction(open);
            text.add(new Table(1).addCell(button).setMarginTop(10));
            String validity = link.expiresAt() != null ? "Link valid until " + day(link.expiresAt()) + ". " : "";
            text.add(paragraph(validity + "Or scan the QR code with your phone.", regular, 7.5f, MUTED).setMarginTop(8));
            // Breaks only after a slash: a line ending with the hyphen of the TEST host reads as hyphenation.
            text.add(new Paragraph(new Link(clean(link.url()), open).setFontColor(SOFT).setUnderline())
                    .setFont(regular).setFontSize(7.5f).setMargin(0).setMarginTop(2)
                    .setSplitCharacters((glyphs, position) -> glyphs.get(position).getUnicode() == '/'));
            panel.addCell(text);

            Image qr = new Image(new BarcodeQRCode(link.url()).createFormXObject(INK, pdf))
                    .scaleToFit(96, 96).setAction(open);
            Cell code = plain().setPadding(14).setVerticalAlignment(VerticalAlignment.MIDDLE)
                    .setTextAlignment(TextAlignment.CENTER);
            Cell quietZone = new Cell().setBorder(Border.NO_BORDER).setBackgroundColor(WHITE)
                    .setPadding(6).add(qr);
            code.add(new Table(1).addCell(quietZone).setHorizontalAlignment(HorizontalAlignment.CENTER));
            code.add(paragraph("Scan to pay", regular, 7, MUTED).setMarginTop(4));
            panel.addCell(code);

            document.add(panel);
        }

        private void notes() {
            if (invoice.notes() == null || invoice.notes().isBlank()) {
                return;
            }
            Div notes = new Div().setMarginTop(18).setKeepTogether(true);
            notes.add(label("Notes"));
            for (String line : invoice.notes().split("\\R")) {
                notes.add(paragraph(line, regular, 8.5f, SOFT));
            }
            document.add(notes);
        }

        private void footers() {
            int pages = pdf.getNumberOfPages();
            String left = seller.name() + "  ·  Invoice " + invoice.number();
            float right = PageSize.A4.getWidth() - MARGIN;
            for (int page = 1; page <= pages; page++) {
                document.showTextAligned(paragraph(left, regular, 7, MUTED), MARGIN, FOOTER_Y, page,
                        TextAlignment.LEFT, VerticalAlignment.BOTTOM, 0);
                document.showTextAligned(paragraph("Created with " + platform.name() + "  ·  Page " + page + " of " + pages,
                                regular, 7, MUTED), right, FOOTER_Y, page,
                        TextAlignment.RIGHT, VerticalAlignment.BOTTOM, 0);
            }
        }

        private Div panel(DeviceRgb background, DeviceRgb border) {
            return new Div().setMarginTop(22).setPadding(14).setBackgroundColor(background)
                    .setBorder(new SolidBorder(border, 0.75f)).setBorderRadius(new BorderRadius(6))
                    .setKeepTogether(true);
        }

        private void columnHeader(Table table, String title, TextAlignment alignment) {
            table.addHeaderCell(new Cell().setBorder(Border.NO_BORDER).setBorderBottom(new SolidBorder(INK, 0.75f))
                    .setPaddingLeft(4).setPaddingRight(4).setPaddingTop(4).setPaddingBottom(5)
                    .setTextAlignment(alignment)
                    .add(paragraph(title.toUpperCase(Locale.ENGLISH), bold, 7, MUTED).setCharacterSpacing(0.4f)));
        }

        private Cell row() {
            return new Cell().setBorder(Border.NO_BORDER).setBorderBottom(new SolidBorder(RULE, 0.5f))
                    .setPaddingLeft(4).setPaddingRight(4).setPaddingTop(6).setPaddingBottom(6)
                    .setKeepTogether(true);
        }

        private Paragraph label(String text) {
            return paragraph(text.toUpperCase(Locale.ENGLISH), bold, 7, MUTED).setCharacterSpacing(0.5f).setMarginBottom(4);
        }

        private Paragraph paragraph(String text, PdfFont font, float size, DeviceRgb color) {
            return new Paragraph(clean(text)).setFont(font).setFontSize(size).setFontColor(color)
                    .setMargin(0).setMultipliedLeading(1.25f);
        }

        private LineSeparator rule(float marginTop) {
            SolidLine line = new SolidLine(0.75f);
            line.setColor(RULE);
            return new LineSeparator(line).setMarginTop(marginTop);
        }

        private String clean(String value) {
            return PdfSupport.clean(regular, value);
        }

        private String money(long minorUnits) {
            return invoice.currency() + " " + number(minorUnits);
        }

        private String number(long minorUnits) {
            int digits = fractionDigits(invoice.currency());
            DecimalFormat format = new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.ENGLISH));
            format.setMinimumFractionDigits(digits);
            format.setMaximumFractionDigits(digits);
            return format.format(BigDecimal.valueOf(minorUnits, digits));
        }

        private static Cell plain() {
            return new Cell().setBorder(Border.NO_BORDER).setPadding(0);
        }
    }

    private static List<String> customerAddress(InvoiceDTO.CustomerRef customer) {
        List<String> lines = new ArrayList<>();
        if (customer.addressLine() != null && !customer.addressLine().isBlank()) {
            lines.add(customer.addressLine());
        }
        String city = String.join(" ", Stream.of(customer.postalCode(), customer.city())
                .filter(value -> value != null && !value.isBlank()).toList());
        if (!city.isEmpty()) {
            lines.add(city);
        }
        if (customer.country() != null && !customer.country().isBlank()) {
            lines.add(new Locale("", customer.country()).getDisplayCountry(Locale.ENGLISH));
        }
        return lines;
    }

    /** "20%", "5.5%" */
    private static String rate(BigDecimal rate) {
        return rate.stripTrailingZeros().toPlainString() + "%";
    }

    private static String day(LocalDate date) {
        return date != null ? DAY.format(date) : "";
    }

    private static String day(Instant instant) {
        return DAY.format(instant.atZone(ZoneOffset.UTC).toLocalDate());
    }

    private static int fractionDigits(String currency) {
        try {
            int digits = Currency.getInstance(currency).getDefaultFractionDigits();
            return digits >= 0 ? digits : 2;
        } catch (RuntimeException e) {
            return 2;
        }
    }
}
