package com.myplatform.demo.service;

import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.io.image.ImageDataFactory;
import com.itextpdf.kernel.colors.ColorConstants;
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
import com.itextpdf.layout.element.AreaBreak;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.element.Div;
import com.itextpdf.layout.element.IBlockElement;
import com.itextpdf.layout.element.Image;
import com.itextpdf.layout.element.LineSeparator;
import com.itextpdf.layout.element.Link;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.element.Text;
import com.itextpdf.layout.properties.AreaBreakType;
import com.itextpdf.layout.properties.HorizontalAlignment;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;
import com.itextpdf.layout.properties.VerticalAlignment;
import com.itextpdf.styledxmlparser.resolver.resource.IResourceRetriever;
import com.itextpdf.svg.converter.SvgConverter;
import com.itextpdf.svg.processors.impl.SvgConverterProperties;
import com.myplatform.demo.util.CamtStatement;
import com.myplatform.demo.util.CamtStatement.Entry;
import com.myplatform.demo.util.CamtStatement.Moment;
import com.myplatform.demo.util.CamtStatement.Statement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Currency;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Stream;

/**
 * The PDF account statement of a business account, laid out as Adyen's compliance guidelines require:
 * issuing bank, platform, account holder, account details, period, balances, every transaction with the
 * balance after it, totals and the bank disclosures. The data from the CAMT.053 file is shown unchanged.
 */
@Service
public class AccountStatementPdfService {

    private static final Logger log = LoggerFactory.getLogger(AccountStatementPdfService.class);

    /** The same default logo as the frontend. */
    private static final String DEFAULT_LOGO = "/default-platform-logo.svg";
    /** The statements of this demo come from Adyen's test environment: the badge keeps them from passing for real ones. */
    private static final String TEST_ONLY = "TEST ONLY – NOT A REAL BANK STATEMENT";
    private static final String ADYEN_WEBSITE = "www.adyen.com";
    private static final String DEPOSITOR_INFORMATION_SHEET =
            "https://docs.adyen.com/business-accounts/compliance-guidelines/eu-depositor-info-sheet";
    /** The disclosures as Adyen's compliance guidelines word them. */
    private static final String DEPOSIT_GUARANTEE = "In the EU, Adyen N.V. is registered with the Dutch deposit "
            + "guarantee scheme register and eligible funds up to EUR 100,000 are legally protected by the Dutch "
            + "deposit guarantee scheme.";
    private static final String NOT_FDIC_INSURED = "Adyen Business Bank Accounts in the United States are not "
            + "insured by the FDIC and are not guaranteed by the Federal Government. If Adyen places deposits in a "
            + "cash sweep program utilizing FDIC-insured depository institutions, such deposits may be covered by "
            + "FDIC insurance up to applicable limits in accordance with the FDIC rules, including those relevant to "
            + "the aggregation of multiple accounts.";

    private static final DeviceRgb INK = new DeviceRgb(17, 24, 39);
    private static final DeviceRgb SOFT = new DeviceRgb(55, 65, 81);
    private static final DeviceRgb MUTED = new DeviceRgb(107, 114, 128);
    private static final DeviceRgb RULE = new DeviceRgb(229, 231, 235);
    private static final DeviceRgb PANEL = new DeviceRgb(243, 244, 246);
    /** The amber of the demo banner of the website. */
    private static final DeviceRgb AMBER_INK = new DeviceRgb(138, 75, 0);
    private static final DeviceRgb AMBER_PANEL = new DeviceRgb(255, 248, 225);
    private static final DeviceRgb AMBER_RULE = new DeviceRgb(240, 192, 80);
    private static final float MARGIN = 36;
    private static final float TOP_MARGIN = 32;
    private static final float BOTTOM_MARGIN = 46;
    private static final float FOOTER_Y = 24;

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH);
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

    /**
     * The platform that offers the account. Adyen doesn't provide it, the statement must show it.
     * logoDataUrl is the branding logo, null for the default one.
     */
    public record Platform(String name, String website, String supportEmail, String supportPhone, String logoDataUrl) {
    }

    public byte[] render(CamtStatement camt, LegalEntityService.Identity holder, Platform platform) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PdfDocument pdf = new PdfDocument(new PdfWriter(out));
        try (Document document = new Document(pdf, PageSize.A4, false)) {
            new Renderer(pdf, document, camt, holder, platform).render();
        } catch (IOException e) {
            throw new UncheckedIOException("Couldn't create the statement PDF", e);
        }
        return out.toByteArray();
    }

    /** Who issues the account and what the statement discloses, per region. */
    private enum Region {
        EU("Bank", "Adyen N.V.", "Simon Carmiggeltstraat 6, 1011DJ, Amsterdam",
                "Business bank account", "Checking account"),
        US("Bank", "Adyen N.V. San Francisco Branch", "505 Brannan Street, San Francisco, CA 94107, United States",
                "Business bank account", "Checking account"),
        UK("Payment service provider", "Adyen N.V. London Branch", "12-13 Wells Mews, London W1T 3HE",
                "Business account", "E-money account");

        final String role;
        final String institution;
        final String address;
        final String product;
        final String accountType;

        Region(String role, String institution, String address, String product, String accountType) {
            this.role = role;
            this.institution = institution;
            this.address = address;
            this.product = product;
            this.accountType = accountType;
        }

        /** EU accounts have an IBAN, US accounts an account number; UK accounts a GB IBAN or a GBP account number. */
        static Region of(CamtStatement.Account account) {
            if (account.iban() != null) {
                return account.iban().startsWith("GB") ? UK : EU;
            }
            if ("USD".equals(account.currency())) {
                return US;
            }
            return "GBP".equals(account.currency()) ? UK : EU;
        }
    }

    private static final class Renderer {

        private final PdfDocument pdf;
        private final Document document;
        private final CamtStatement camt;
        private final LegalEntityService.Identity holder;
        private final Platform platform;
        private final PdfFont regular;
        private final PdfFont bold;

        Renderer(PdfDocument pdf, Document document, CamtStatement camt, LegalEntityService.Identity holder,
                 Platform platform) throws IOException {
            this.pdf = pdf;
            this.document = document;
            this.camt = camt;
            this.holder = holder;
            this.platform = platform;
            this.regular = PdfFontFactory.createFont(StandardFonts.HELVETICA);
            this.bold = PdfFontFactory.createFont(StandardFonts.HELVETICA_BOLD);
        }

        void render() {
            Statement first = camt.statements().get(0);
            pdf.getDocumentInfo()
                    .setTitle("Account statement " + period(first))
                    .setAuthor(platform.name());
            document.setMargins(TOP_MARGIN, MARGIN, BOTTOM_MARGIN, MARGIN);
            document.setFont(regular).setFontSize(8.5f).setFontColor(INK);
            for (int i = 0; i < camt.statements().size(); i++) {
                if (i > 0) {
                    document.add(new AreaBreak(AreaBreakType.NEXT_PAGE));
                }
                statement(camt.statements().get(i));
            }
            footers(first);
        }

        private void statement(Statement statement) {
            Region region = Region.of(statement.account());
            header(statement, region);
            parties(statement, region);
            summary(statement);
            transactions(statement, region);
            about(region);
            disclosures(region);
        }

        private void header(Statement statement, Region region) {
            Table header = new Table(UnitValue.createPercentArray(new float[]{55, 45})).useAllAvailableWidth();
            header.addCell(plain().add(brand()).setVerticalAlignment(VerticalAlignment.MIDDLE));
            Cell title = plain().setTextAlignment(TextAlignment.RIGHT);
            title.add(testBadge());
            title.add(paragraph("Account statement", bold, 17, INK));
            title.add(paragraph(region.product, regular, 9, MUTED).setMarginTop(2));
            title.add(paragraph(period(statement), bold, 10, INK).setMarginTop(8));
            String days = days(statement);
            if (days != null) {
                title.add(paragraph(days, regular, 8, MUTED).setMarginTop(1));
            }
            header.addCell(title);
            document.add(header);
            document.add(rule(12));
        }

        private Table testBadge() {
            Cell badge = new Cell().setBorder(new SolidBorder(AMBER_RULE, 0.75f)).setBackgroundColor(AMBER_PANEL)
                    .setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(6).setPaddingRight(6)
                    .add(paragraph(TEST_ONLY, bold, 7, AMBER_INK).setCharacterSpacing(0.4f));
            return new Table(1).addCell(badge).setHorizontalAlignment(HorizontalAlignment.RIGHT).setMarginBottom(6);
        }

        private IBlockElement brand() {
            Paragraph name = paragraph(platform.name(), bold, 13, INK);
            Image logo = logo();
            if (logo == null) {
                return name;
            }
            Table brand = new Table(2);
            brand.addCell(plain().add(logo.scaleToFit(110, 32)).setPaddingRight(8)
                    .setVerticalAlignment(VerticalAlignment.MIDDLE));
            brand.addCell(plain().add(name).setVerticalAlignment(VerticalAlignment.MIDDLE));
            return brand;
        }

        private void parties(Statement statement, Region region) {
            Table grid = new Table(UnitValue.createPercentArray(new float[]{50, 50})).useAllAvailableWidth()
                    .setMarginTop(12);

            Cell holderCell = plain().setPaddingRight(18);
            holderCell.add(label("Account holder"));
            Paragraph name = new Paragraph().setFont(bold).setFontSize(10).setMargin(0).setMultipliedLeading(1.25f);
            name.add(clean(holder.name()));
            if (holder.doingBusinessAs() != null) {
                name.add(new Text(", Doing Business As ").setFont(regular));
                name.add(clean(holder.doingBusinessAs()));
            }
            holderCell.add(name);
            for (String line : holder.address()) {
                holderCell.add(paragraph(line, regular, 8.5f, INK));
            }
            grid.addCell(holderCell);

            CamtStatement.Account account = statement.account();
            String lastFour = lastFour(account.number());
            Cell accountCell = plain();
            accountCell.add(label("Account details"));
            Table details = new Table(UnitValue.createPercentArray(new float[]{38, 62})).useAllAvailableWidth();
            detail(details, "Account type", region.accountType);
            detail(details, "Account number", lastFour != null ? "•••• " + lastFour : null);
            detail(details, "Currency", account.currency());
            detail(details, "IBAN", formatIban(account.iban()));
            detail(details, "BIC", account.bic());
            detail(details, "Statement number", statement.id());
            detail(details, "Created on", statement.createdAt() != null ? dateTime(statement.createdAt()) : null);
            accountCell.add(details);
            grid.addCell(accountCell);

            document.add(grid);
        }

        private void detail(Table details, String label, String value) {
            if (value == null) {
                return;
            }
            details.addCell(plain().setPaddingBottom(1).add(paragraph(label, regular, 8.5f, MUTED)));
            details.addCell(plain().setPaddingBottom(1).add(paragraph(value, regular, 8.5f, INK)));
        }

        private void summary(Statement statement) {
            String currency = statement.account().currency();
            Table summary = new Table(UnitValue.createPercentArray(4)).useAllAvailableWidth().setMarginTop(14);
            summary.addCell(metric("Opening balance", balance(statement.opening(), currency),
                    balanceDay(statement.opening()), true));
            summary.addCell(metric("Money in", money(statement.credits().sum(), currency),
                    count(statement.credits().count(), "credit"), false));
            summary.addCell(metric("Money out", money(statement.debits().sum(), currency),
                    count(statement.debits().count(), "debit"), false));
            summary.addCell(metric("Closing balance", balance(statement.closing(), currency),
                    balanceDay(statement.closing()), false));
            document.add(summary);
            BigDecimal interest = interest(statement);
            if (interest != null) {
                document.add(paragraph("Interest earned in this statement cycle: " + money(interest, currency),
                        regular, 7.5f, MUTED).setMarginTop(5));
            }
        }

        private Cell metric(String label, String value, String note, boolean first) {
            Cell cell = new Cell().setBorder(Border.NO_BORDER).setBackgroundColor(PANEL).setPadding(8);
            if (!first) {
                cell.setBorderLeft(new SolidBorder(ColorConstants.WHITE, 2));
            }
            cell.add(label(label));
            cell.add(paragraph(value, bold, 11, INK));
            if (note != null) {
                cell.add(paragraph(note, regular, 7.5f, MUTED).setMarginTop(2));
            }
            return cell;
        }

        private void transactions(Statement statement, Region region) {
            String currency = statement.account().currency();
            ZoneOffset offset = commonOffset(statement);
            String notes = String.join("  ·  ", Stream.of(
                            currency != null ? "Amounts in " + currency : null,
                            offset != null ? "Times in " + utc(offset) : null)
                    .filter(Objects::nonNull).toList());
            Table heading = new Table(UnitValue.createPercentArray(new float[]{50, 50})).useAllAvailableWidth()
                    .setMarginTop(16).setMarginBottom(2);
            heading.addCell(plain().add(paragraph("Transactions", bold, 11, INK))
                    .setVerticalAlignment(VerticalAlignment.BOTTOM));
            heading.addCell(plain().add(paragraph(notes, regular, 7.5f, MUTED))
                    .setTextAlignment(TextAlignment.RIGHT).setVerticalAlignment(VerticalAlignment.BOTTOM));
            document.add(heading);

            Table table = new Table(UnitValue.createPercentArray(new float[]{12, 17, 34, 12, 12, 13}))
                    .useAllAvailableWidth();
            columnHeader(table, "Date", TextAlignment.LEFT);
            columnHeader(table, "Type", TextAlignment.LEFT);
            columnHeader(table, "Payer / payee", TextAlignment.LEFT);
            columnHeader(table, "Money out", TextAlignment.RIGHT);
            columnHeader(table, "Money in", TextAlignment.RIGHT);
            columnHeader(table, "Balance", TextAlignment.RIGHT);

            BigDecimal balance = statement.opening() != null ? statement.opening().amount() : null;
            balanceRow(table, statement.from(), "Opening balance", balance, currency);
            if (statement.entries().isEmpty()) {
                table.addCell(row(6).add(paragraph("No transactions in this period.", regular, 8.5f, MUTED)));
            }
            for (Entry entry : statement.entries()) {
                if (entry.booked() && balance != null) {
                    balance = balance.add(entry.signedAmount());
                }
                table.addCell(row(1).add(dateLines(entry.date(), offset == null)));
                table.addCell(typeCell(entry, region));
                table.addCell(partyCell(entry, currency));
                table.addCell(amountCell(entry.credit() ? null : entry.amount(), entry.currency(), currency, false));
                table.addCell(amountCell(entry.credit() ? entry.amount() : null, entry.currency(), currency, false));
                table.addCell(entry.booked() && balance != null
                        ? amountCell(balance, currency, currency, false)
                        : row(1).setTextAlignment(TextAlignment.RIGHT).add(paragraph("—", regular, 8.5f, MUTED)));
            }

            SolidBorder strong = new SolidBorder(INK, 0.75f);
            table.addCell(row(3).setBorderTop(strong).add(paragraph("Total", bold, 8.5f, INK)));
            table.addCell(amountCell(statement.debits().sum(), currency, currency, true).setBorderTop(strong));
            table.addCell(amountCell(statement.credits().sum(), currency, currency, true).setBorderTop(strong));
            table.addCell(row(1).setBorderTop(strong));
            balanceRow(table, statement.to(), "Closing balance",
                    statement.closing() != null ? statement.closing().amount() : null, currency);
            document.add(table);

            if (balance != null && statement.closing() != null && balance.compareTo(statement.closing().amount()) != 0) {
                log.warn("Statement {}: the entries lead to {} but the closing balance is {}",
                        statement.id(), balance, statement.closing().amount());
            }
        }

        private void balanceRow(Table table, Moment day, String label, BigDecimal amount, String currency) {
            table.addCell(row(1).add(paragraph(day != null ? day(day.date()) : "", regular, 8.5f, INK)));
            table.addCell(row(4).add(paragraph(label, bold, 8.5f, INK)));
            table.addCell(amount != null
                    ? amountCell(amount, currency, currency, true)
                    : row(1).setTextAlignment(TextAlignment.RIGHT).add(paragraph("—", regular, 8.5f, MUTED)));
        }

        private void columnHeader(Table table, String title, TextAlignment alignment) {
            table.addHeaderCell(new Cell().setBorder(Border.NO_BORDER).setBorderBottom(new SolidBorder(INK, 0.75f))
                    .setPaddingLeft(4).setPaddingRight(4).setPaddingTop(4).setPaddingBottom(5)
                    .setTextAlignment(alignment)
                    .add(paragraph(title.toUpperCase(Locale.ENGLISH), bold, 7, MUTED).setCharacterSpacing(0.4f)));
        }

        private Cell row(int columns) {
            return new Cell(1, columns).setBorder(Border.NO_BORDER).setBorderBottom(new SolidBorder(RULE, 0.5f))
                    .setPaddingLeft(4).setPaddingRight(4).setPaddingTop(4).setPaddingBottom(4)
                    .setKeepTogether(true); // a row moves to the next page rather than splitting
        }

        /** withOffset: the times of the statement don't share one offset, so each time shows its own. */
        private Div dateLines(Moment moment, boolean withOffset) {
            Div lines = new Div();
            if (moment == null) {
                return lines.add(paragraph("—", regular, 8.5f, MUTED));
            }
            lines.add(paragraph(day(moment.date()), regular, 8.5f, INK));
            if (moment.time() != null) {
                String time = TIME.format(moment.time());
                lines.add(small(withOffset && moment.offset() != null ? time + " " + utc(moment.offset()) : time));
            }
            return lines;
        }

        private Cell typeCell(Entry entry, Region region) {
            Cell cell = row(1);
            String type = type(entry, region);
            cell.add(paragraph(type, regular, 8.5f, INK));
            String code = code(entry);
            if (code != null && (type.equals("Credit") || type.equals("Debit"))) {
                cell.add(small(code));
            }
            if (!entry.booked()) {
                cell.add(small("Not booked yet"));
            }
            return cell;
        }

        private Cell partyCell(Entry entry, String currency) {
            Cell cell = row(1);
            cell.add(paragraph(entry.counterpartyName() != null ? entry.counterpartyName() : "—", regular, 8.5f, INK));
            String account = entry.counterpartyAccount();
            if (account != null) {
                cell.add(small(isIban(account) ? formatIban(account) : account));
            }
            if (entry.remittanceInfo() != null) {
                cell.add(small(entry.remittanceInfo()));
            }
            CamtStatement.Money instructed = entry.instructed();
            if (instructed != null && instructed.currency() != null && !instructed.currency().equals(entry.currency())) {
                String original = "Original amount " + money(instructed.amount(), instructed.currency());
                cell.add(small(entry.exchangeRate() != null ? original + ", exchange rate " + entry.exchangeRate() : original));
            }
            if (entry.charges() != null) {
                String chargesCurrency = entry.charges().currency() != null ? entry.charges().currency() : currency;
                cell.add(small("Fees " + money(entry.charges().amount(), chargesCurrency)));
            }
            return cell;
        }

        private Cell amountCell(BigDecimal amount, String amountCurrency, String accountCurrency, boolean strong) {
            Cell cell = row(1).setTextAlignment(TextAlignment.RIGHT);
            if (amount != null) {
                String text = amountCurrency == null || amountCurrency.equals(accountCurrency)
                        ? number(amount, accountCurrency)
                        : money(amount, amountCurrency);
                cell.add(paragraph(text, strong ? bold : regular, 8.5f, INK));
            }
            return cell;
        }

        private void about(Region region) {
            Table about = new Table(UnitValue.createPercentArray(new float[]{50, 50})).useAllAvailableWidth()
                    .setMarginTop(16).setKeepTogether(true);

            Cell platformCell = plain().setPaddingRight(18);
            platformCell.add(label("Platform"));
            platformCell.add(paragraph(platform.name(), bold, 9, INK));
            platformCell.add(linkLine("Website ", platform.website(), platform.website()));
            platformCell.add(linkLine("Support email ", platform.supportEmail(), "mailto:" + platform.supportEmail()));
            platformCell.add(linkLine("Support phone ", platform.supportPhone(),
                    "tel:" + platform.supportPhone().replaceAll("[^+0-9]", "")));
            platformCell.add(paragraph("For questions about this statement or your account, contact "
                    + platform.name() + " customer support.", regular, 7.5f, MUTED).setMarginTop(4));
            about.addCell(platformCell);

            Cell bankCell = plain();
            bankCell.add(label(region.role));
            bankCell.add(paragraph(region.institution, bold, 9, INK));
            bankCell.add(paragraph(region.address, regular, 8.5f, INK));
            bankCell.add(linkLine("", ADYEN_WEBSITE, "https://" + ADYEN_WEBSITE));
            bankCell.add(paragraph(region.institution + " is the financial institution issuing your "
                    + region.product.toLowerCase(Locale.ENGLISH) + ".", regular, 7.5f, MUTED).setMarginTop(4));
            about.addCell(bankCell);

            document.add(about);
        }

        private void disclosures(Region region) {
            Div box = new Div().setMarginTop(12).setPadding(9).setBackgroundColor(PANEL).setKeepTogether(true);
            box.add(label("Important information"));
            String info = camt.additionalInfo();
            if (info != null) {
                box.add(fine(info));
            }
            if (region == Region.EU) {
                if (!mentions(info, "deposit guarantee scheme")) {
                    box.add(fine(DEPOSIT_GUARANTEE));
                }
                box.add(fine("The Depositor Information Sheet explains how your deposits with Adyen N.V. are protected: ")
                        .add(new Link(DEPOSITOR_INFORMATION_SHEET, PdfAction.createURI(DEPOSITOR_INFORMATION_SHEET))
                                .setUnderline()));
            }
            if (region == Region.US && !mentions(info, "insured by the FDIC")) {
                box.add(fine(NOT_FDIC_INSURED));
            }
            if (box.getChildren().size() > 1) { // a UK statement can have nothing to disclose
                document.add(box);
            }
        }

        private void footers(Statement first) {
            int pages = pdf.getNumberOfPages();
            String left = platform.name() + "  ·  Account statement  ·  " + period(first);
            float right = PageSize.A4.getWidth() - MARGIN;
            for (int page = 1; page <= pages; page++) {
                document.showTextAligned(paragraph(left, regular, 7, MUTED), MARGIN, FOOTER_Y, page,
                        TextAlignment.LEFT, VerticalAlignment.BOTTOM, 0);
                document.showTextAligned(paragraph("Page " + page + " of " + pages, regular, 7, MUTED), right, FOOTER_Y, page,
                        TextAlignment.RIGHT, VerticalAlignment.BOTTOM, 0);
            }
        }

        /** The branding logo, or the default one when the platform has none; null when it can't be drawn. */
        private Image logo() {
            String dataUrl = platform.logoDataUrl();
            try {
                if (!notBlank(dataUrl)) {
                    try (InputStream in = AccountStatementPdfService.class.getResourceAsStream(DEFAULT_LOGO)) {
                        return in != null ? svg(in) : null;
                    }
                }
                byte[] bytes = decode(dataUrl);
                if (isSvg(bytes)) {
                    return svg(new ByteArrayInputStream(bytes));
                }
                if (!ImageDataFactory.isSupportedType(bytes)) {
                    log.warn("Statement PDF created without the platform logo: unsupported image format");
                    return null;
                }
                return new Image(ImageDataFactory.create(bytes));
            } catch (Exception e) {
                log.warn("Statement PDF created without the platform logo: {}", e.getMessage());
                return null;
            }
        }

        private Image svg(InputStream in) throws IOException {
            return new Image(SvgConverter.convertToXObject(in, pdf, new SvgConverterProperties().setResourceRetriever(OFFLINE)));
        }

        private Paragraph linkLine(String prefix, String text, String uri) {
            Paragraph line = paragraph(prefix, regular, 8.5f, prefix.isEmpty() ? INK : MUTED);
            return line.add(new Link(clean(text.trim()), PdfAction.createURI(uri)).setFontColor(INK));
        }

        private Paragraph label(String text) {
            return paragraph(text.toUpperCase(Locale.ENGLISH), bold, 7, MUTED).setCharacterSpacing(0.5f).setMarginBottom(4);
        }

        private Paragraph small(String text) {
            return paragraph(text, regular, 7, MUTED).setMarginTop(1);
        }

        private Paragraph fine(String text) {
            return paragraph(text, regular, 7.5f, SOFT).setMarginTop(4);
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

        private static Cell plain() {
            return new Cell().setBorder(Border.NO_BORDER).setPadding(0);
        }

        /** The standard font draws Western European text: other letters lose their accent, or become "?". */
        private String clean(String value) {
            if (value == null) {
                return "";
            }
            StringBuilder text = new StringBuilder(value.length());
            value.codePoints().forEach(codePoint -> {
                if (Character.isWhitespace(codePoint) || Character.isISOControl(codePoint)) {
                    text.append(' ');
                } else if (regular.containsGlyph(codePoint)) {
                    text.appendCodePoint(codePoint);
                } else {
                    text.append(replacement(codePoint));
                }
            });
            return text.toString();
        }

        private String replacement(int codePoint) {
            String replacement = codePoint <= Character.MAX_VALUE ? UNDECOMPOSABLE.get((char) codePoint) : null;
            if (replacement == null) {
                replacement = Normalizer.normalize(new String(Character.toChars(codePoint)), Normalizer.Form.NFD)
                        .replaceAll("\\p{M}", "");
            }
            return !replacement.isEmpty() && replacement.codePoints().allMatch(regular::containsGlyph) ? replacement : "?";
        }
    }

    /** "19 Oct 2026 – 19 Oct 2026": the guidelines ask for the first and the last day, even when they're the same. */
    private static String period(Statement statement) {
        LocalDate first = statement.from() != null ? statement.from().date() : null;
        LocalDate last = lastDay(statement);
        if (first == null || last == null) {
            return first != null ? day(first) : last != null ? day(last) : "";
        }
        return day(first) + " – " + day(last);
    }

    private static String days(Statement statement) {
        LocalDate last = lastDay(statement);
        if (statement.from() == null || last == null) {
            return null;
        }
        long days = ChronoUnit.DAYS.between(statement.from().date(), last) + 1;
        return days > 0 ? days + (days == 1 ? " day" : " days") + " in this statement cycle" : null;
    }

    /** A period that ends at midnight doesn't include that day. */
    private static LocalDate lastDay(Statement statement) {
        Moment to = statement.to();
        if (to == null) {
            return null;
        }
        boolean exclusiveEnd = LocalTime.MIDNIGHT.equals(to.time())
                && statement.from() != null && to.date().isAfter(statement.from().date());
        return exclusiveEnd ? to.date().minusDays(1) : to.date();
    }

    /** The offset of every date and time of the statement, or null when they differ or have none. */
    private static ZoneOffset commonOffset(Statement statement) {
        Set<ZoneOffset> offsets = new HashSet<>();
        for (Entry entry : statement.entries()) {
            if (entry.date() != null && entry.date().time() != null) {
                offsets.add(entry.date().offset());
            }
        }
        return offsets.size() == 1 ? offsets.iterator().next() : null;
    }

    /** The bank transaction code in words, e.g. ACMT/MCOP/INTR for an interest payout. */
    private static String type(Entry entry, Region region) {
        String family = Objects.requireNonNullElse(entry.family(), "");
        String subFamily = Objects.requireNonNullElse(entry.subFamily(), "");
        String bySubFamily = switch (subFamily) {
            case "INTR" -> "Interest";
            case "CHRG", "FEES", "COMM" -> "Fee";
            case "TOPG" -> "Top-up";
            case "RRTN" -> family.equals("RRCT") || family.equals("IRCT") ? "Returned instant transfer" : "Returned transfer";
            default -> null;
        };
        if (bySubFamily != null) {
            return bySubFamily;
        }
        return switch (family) {
            case "CCRD" -> "Card transaction";
            case "RDDT" -> "Direct debit";
            case "RRCT" -> "Incoming instant transfer";
            case "IRCT" -> "Outgoing instant transfer";
            case "RCDT" -> "Incoming " + transferMethod(subFamily, region);
            case "ICDT" -> "Outgoing " + transferMethod(subFamily, region);
            default -> entry.credit() ? "Credit" : "Debit";
        };
    }

    /** The interest booked in the period, null when the statement has no interest entry. */
    private static BigDecimal interest(Statement statement) {
        return statement.entries().stream()
                .filter(entry -> entry.booked() && "INTR".equals(entry.subFamily()))
                .map(Entry::signedAmount)
                .reduce(BigDecimal::add)
                .orElse(null);
    }

    private static String transferMethod(String subFamily, Region region) {
        return switch (subFamily) {
            case "ACDT" -> region == Region.US ? "ACH transfer" : "bank transfer";
            case "SDVA" -> "same-day transfer";
            case "PRCT" -> "wire transfer";
            case "XBCT" -> "cross-border transfer";
            case "BOOK" -> "internal transfer";
            default -> "transfer";
        };
    }

    /** The bank transaction code, e.g. PMNT/ICDT/ACDT; null when the entry has none. */
    private static String code(Entry entry) {
        String code = String.join("/", Stream.of(entry.domain(), entry.family(), entry.subFamily())
                .filter(Objects::nonNull).toList());
        return code.isEmpty() ? null : code;
    }

    /** "UTC+1", "UTC+5:30", "UTC-3" */
    private static String utc(ZoneOffset offset) {
        int seconds = offset.getTotalSeconds();
        if (seconds == 0) {
            return "UTC";
        }
        int minutes = Math.abs(seconds) / 60;
        return "UTC" + (seconds < 0 ? "-" : "+") + minutes / 60
                + (minutes % 60 != 0 ? String.format(Locale.ROOT, ":%02d", minutes % 60) : "");
    }

    private static boolean mentions(String text, String phrase) {
        return text != null && text.toLowerCase(Locale.ROOT).contains(phrase.toLowerCase(Locale.ROOT));
    }

    private static String balance(CamtStatement.Balance balance, String currency) {
        return balance != null ? money(balance.amount(), balance.currency() != null ? balance.currency() : currency) : "—";
    }

    private static String balanceDay(CamtStatement.Balance balance) {
        return balance != null && balance.date() != null ? "On " + day(balance.date()) : null;
    }

    private static String count(int count, String noun) {
        return count + " " + noun + (count == 1 ? "" : "s");
    }

    private static String day(LocalDate date) {
        return DAY.format(date);
    }

    private static String dateTime(Moment moment) {
        return moment.time() != null ? day(moment.date()) + ", " + TIME.format(moment.time()) : day(moment.date());
    }

    private static String money(BigDecimal amount, String currency) {
        return (currency != null ? currency + " " : "") + number(amount, currency);
    }

    /** "97,636.22": the currency's decimals, more when Adyen sent more, so nothing is rounded. */
    private static String number(BigDecimal amount, String currency) {
        int scale = Math.max(fractionDigits(currency), Math.max(0, amount.stripTrailingZeros().scale()));
        DecimalFormat format = new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.ENGLISH));
        format.setMinimumFractionDigits(scale);
        format.setMaximumFractionDigits(scale);
        return format.format(amount);
    }

    private static int fractionDigits(String currency) {
        try {
            int digits = Currency.getInstance(currency).getDefaultFractionDigits();
            return digits >= 0 ? digits : 2;
        } catch (RuntimeException e) {
            return 2;
        }
    }

    private static String lastFour(String accountNumber) {
        if (accountNumber == null) {
            return null;
        }
        String characters = accountNumber.replaceAll("[^A-Za-z0-9]", "");
        return characters.length() <= 4 ? characters : characters.substring(characters.length() - 4);
    }

    private static boolean isIban(String value) {
        return value.replaceAll("\\s+", "").matches("[A-Z]{2}\\d{2}[A-Z0-9]{8,30}");
    }

    /** "NL83 ADYX 2018 3119 79" */
    private static String formatIban(String iban) {
        return iban == null ? null : iban.replaceAll("\\s+", "").replaceAll("(.{4})(?!$)", "$1 ");
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
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
