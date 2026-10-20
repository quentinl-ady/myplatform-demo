package com.myplatform.demo.util;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoField;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * What an account statement shows from a CAMT.053 file (ISO 20022 BankToCustomerStatement).
 * Values stay as Adyen wrote them: amounts aren't rounded, dates and times keep the offset of the file.
 * Elements are matched by local name, so camt.053.001.02 and the later versions read the same.
 */
public record CamtStatement(String additionalInfo, Party recipient, List<Statement> statements) {

    /** Used only when an entry has no credit/debit indicator. */
    private static final Set<String> CREDIT_FAMILIES = Set.of("RCDT", "RRCT", "MCOP", "ACCB");

    /** The account holder the file is addressed to, with the postal lines in the order of its country. */
    public record Party(String name, List<String> address) {
    }

    /** A date as the file writes it. time and offset are null for a date without time. */
    public record Moment(LocalDate date, LocalTime time, ZoneOffset offset) {
    }

    public record Money(BigDecimal amount, String currency) {
    }

    /** iban is null for the accounts identified by another number (US, UK). */
    public record Account(String iban, String otherId, String currency, String bic) {

        public String number() {
            return iban != null ? iban : otherId;
        }
    }

    /** amount is negative for a debit balance. */
    public record Balance(String code, BigDecimal amount, String currency, LocalDate date) {
    }

    public record Totals(int count, BigDecimal sum) {
    }

    /**
     * An entry of the account. amount is unsigned, credit gives the direction.
     * The counterparty is the payer of a credit and the payee of a debit.
     * instructed is the amount sent in another currency, exchangeRate the rate applied to it.
     */
    public record Entry(BigDecimal amount, String currency, boolean credit, String status,
                        Moment bookingDate, Moment valueDate,
                        String domain, String family, String subFamily,
                        String counterpartyName, String counterpartyAccount, String remittanceInfo,
                        Money charges, Money instructed, String exchangeRate) {

        /** Pending and information-only entries don't change the balance. */
        public boolean booked() {
            return status == null || "BOOK".equals(status);
        }

        public BigDecimal signedAmount() {
            return credit ? amount : amount.negate();
        }

        public Moment date() {
            return bookingDate != null ? bookingDate : valueDate;
        }
    }

    /** opening and closing are null when the file has no such balance. */
    public record Statement(String id, Moment createdAt, Moment from, Moment to, Account account,
                            Balance opening, Balance closing, List<Entry> entries,
                            Totals credits, Totals debits) {
    }

    /** @throws IllegalArgumentException when the file isn't a readable CAMT.053 statement */
    public static CamtStatement parse(byte[] xml) {
        Element message = child(document(xml).getDocumentElement(), "BkToCstmrStmt");
        List<Statement> statements = children(message, "Stmt").stream().map(CamtStatement::statement).toList();
        if (statements.isEmpty()) {
            throw new IllegalArgumentException("No CAMT.053 statement in the file");
        }
        return new CamtStatement(text(message, "GrpHdr", "AddtlInf"), party(child(message, "GrpHdr", "MsgRcpt")),
                statements);
    }

    private static Document document(byte[] xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            builder.setErrorHandler(new DefaultHandler()); // throws on fatal errors instead of printing them
            return builder.parse(new ByteArrayInputStream(xml));
        } catch (Exception e) {
            throw new IllegalArgumentException("Unreadable XML: " + e.getMessage(), e);
        }
    }

    private static Statement statement(Element stmt) {
        Element account = child(stmt, "Acct");
        Element servicer = child(account, "Svcr", "FinInstnId");
        List<Balance> balances = children(stmt, "Bal").stream()
                .map(CamtStatement::balance)
                .filter(Objects::nonNull)
                .toList();
        Balance opening = balance(balances, "OPBD", "OPAV", "PRCD");
        Balance closing = balance(balances, "CLBD", "CLAV");
        List<Entry> entries = children(stmt, "Ntry").stream().map(CamtStatement::entry).toList();
        Element summary = child(stmt, "TxsSummry");
        Moment from = moment(text(stmt, "FrToDt", "FrDtTm"));
        Moment to = moment(text(stmt, "FrToDt", "ToDtTm"));
        return new Statement(
                text(stmt, "Id"),
                moment(text(stmt, "CreDtTm")),
                from != null ? from : day(opening),
                to != null ? to : day(closing),
                new Account(text(account, "Id", "IBAN"), text(account, "Id", "Othr", "Id"), text(account, "Ccy"),
                        firstNonNull(text(servicer, "BIC"), text(servicer, "BICFI"))),
                opening,
                closing,
                entries,
                totals(child(summary, "TtlCdtNtries"), entries, true),
                totals(child(summary, "TtlDbtNtries"), entries, false));
    }

    /** AdrLine holds the street when the address isn't split into street name and building number. */
    private static Party party(Element party) {
        String name = text(party, "Nm");
        if (name == null) {
            return null;
        }
        Element address = child(party, "PstlAdr");
        if (address == null) {
            return new Party(name, List.of());
        }
        List<String> street = new ArrayList<>();
        for (Element line : children(address, "AdrLine")) {
            addIfPresent(street, text(line));
        }
        if (street.isEmpty()) {
            addIfPresent(street, PostalAddress.join(" ", text(address, "StrtNm"), text(address, "BldgNb")));
        }
        return new Party(name, PostalAddress.lines(street, text(address, "PstCd"), text(address, "TwnNm"),
                text(address, "CtrySubDvsn"), text(address, "Ctry")));
    }

    private static Balance balance(Element bal) {
        String code = firstNonNull(text(bal, "Tp", "CdOrPrtry", "Cd"), text(bal, "Tp", "CdOrPrtry", "Prtry"));
        Element amount = child(bal, "Amt");
        if (code == null || amount == null) {
            return null;
        }
        BigDecimal value = decimal(amount);
        Moment date = moment(firstNonNull(text(bal, "Dt", "Dt"), text(bal, "Dt", "DtTm")));
        return new Balance(code, "DBIT".equals(text(bal, "CdtDbtInd")) ? value.negate() : value,
                attribute(amount, "Ccy"), date != null ? date.date() : null);
    }

    /** The day of the balance, for the files without period. */
    private static Moment day(Balance balance) {
        return balance != null && balance.date() != null ? new Moment(balance.date(), null, null) : null;
    }

    /** The first balance of the given types, in this order of preference. */
    private static Balance balance(List<Balance> balances, String... codes) {
        for (String code : codes) {
            for (Balance balance : balances) {
                if (code.equals(balance.code())) {
                    return balance;
                }
            }
        }
        return null;
    }

    /** Adyen's totals when the file has a summary, otherwise the sum of the booked entries. */
    private static Totals totals(Element summary, List<Entry> entries, boolean credit) {
        String count = text(summary, "NbOfNtries");
        String sum = text(summary, "Sum");
        if (count != null && sum != null) {
            return new Totals(Integer.parseInt(count), new BigDecimal(sum));
        }
        List<Entry> matching = entries.stream().filter(e -> e.booked() && e.credit() == credit).toList();
        return new Totals(matching.size(), matching.stream().map(Entry::amount).reduce(BigDecimal.ZERO, BigDecimal::add));
    }

    private static Entry entry(Element ntry) {
        Element amount = child(ntry, "Amt");
        if (amount == null) {
            throw new IllegalArgumentException("Entry without amount");
        }
        Element domain = child(ntry, "BkTxCd", "Domn");
        String family = text(domain, "Fmly", "Cd");
        String indicator = text(ntry, "CdtDbtInd");
        boolean credit = indicator != null ? "CRDT".equals(indicator) : CREDIT_FAMILIES.contains(family);

        Element tx = child(ntry, "NtryDtls", "TxDtls");
        Element parties = child(tx, "RltdPties");
        String side = credit ? "Dbtr" : "Cdtr";
        Element counterpartyAccount = child(parties, side + "Acct", "Id");
        Element instructed = child(tx, "AmtDtls", "InstdAmt");
        Element instructedAmount = child(instructed, "Amt");

        return new Entry(
                decimal(amount),
                attribute(amount, "Ccy"),
                credit,
                text(ntry, "Sts"),
                moment(firstNonNull(text(ntry, "BookgDt", "DtTm"), text(ntry, "BookgDt", "Dt"))),
                moment(firstNonNull(text(ntry, "ValDt", "DtTm"), text(ntry, "ValDt", "Dt"))),
                text(domain, "Cd"),
                family,
                text(domain, "Fmly", "SubFmlyCd"),
                firstNonNull(partyName(child(parties, side)), partyName(child(parties, "Ultmt" + side))),
                firstNonNull(text(counterpartyAccount, "IBAN"), text(counterpartyAccount, "Othr", "Id")),
                remittanceInfo(ntry, tx),
                charges(ntry, tx),
                instructedAmount != null ? new Money(decimal(instructedAmount), attribute(instructedAmount, "Ccy")) : null,
                firstNonNull(text(instructed, "CcyXchg", "XchgRate"), text(tx, "AmtDtls", "TxAmt", "CcyXchg", "XchgRate")));
    }

    private static String remittanceInfo(Element ntry, Element tx) {
        Element info = child(tx, "RmtInf");
        List<String> parts = new ArrayList<>();
        for (Element unstructured : children(info, "Ustrd")) {
            addIfPresent(parts, text(unstructured));
        }
        for (Element structured : children(info, "Strd")) {
            addIfPresent(parts, text(structured, "CdtrRefInf", "Ref"));
        }
        if (parts.isEmpty()) {
            addIfPresent(parts, firstNonNull(text(tx, "AddtlTxInf"), text(ntry, "AddtlNtryInf")));
        }
        return parts.isEmpty() ? null : String.join(" ", parts);
    }

    /** The fees of the entry, or of its transaction when the entry has none. */
    private static Money charges(Element ntry, Element tx) {
        List<Element> blocks = children(ntry, "Chrgs");
        if (blocks.isEmpty()) {
            blocks = children(tx, "Chrgs");
        }
        BigDecimal total = null;
        String currency = null;
        for (Element block : blocks) {
            List<Element> amounts = new ArrayList<>(children(block, "Amt")); // camt.053.001.02
            for (Element record : children(block, "Rcrd")) { // later versions
                amounts.addAll(children(record, "Amt"));
            }
            for (Element amount : amounts) {
                total = total == null ? decimal(amount) : total.add(decimal(amount));
                currency = attribute(amount, "Ccy");
            }
        }
        return total != null && total.signum() != 0 ? new Money(total, currency) : null;
    }

    private static Moment moment(String value) {
        if (value == null) {
            return null;
        }
        try {
            TemporalAccessor parsed = value.contains("T")
                    ? DateTimeFormatter.ISO_DATE_TIME.parse(value)
                    : DateTimeFormatter.ISO_DATE.parse(value);
            return new Moment(LocalDate.from(parsed),
                    parsed.isSupported(ChronoField.HOUR_OF_DAY) ? LocalTime.from(parsed) : null,
                    parsed.isSupported(ChronoField.OFFSET_SECONDS) ? ZoneOffset.from(parsed) : null);
        } catch (DateTimeException e) {
            return null;
        }
    }

    private static String partyName(Element party) {
        return firstNonNull(text(party, "Nm"), text(party, "Pty", "Nm"));
    }

    private static List<Element> children(Element parent, String name) {
        List<Element> children = new ArrayList<>();
        if (parent == null) {
            return children;
        }
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element element && name.equals(localName(element))) {
                children.add(element);
            }
        }
        return children;
    }

    private static Element child(Element parent, String... path) {
        Element current = parent;
        for (String name : path) {
            List<Element> found = children(current, name);
            current = found.isEmpty() ? null : found.get(0);
        }
        return current;
    }

    /** The trimmed text, null when the element is missing or empty. */
    private static String text(Element parent, String... path) {
        Element element = child(parent, path);
        if (element == null) {
            return null;
        }
        String value = element.getTextContent().trim();
        return value.isEmpty() ? null : value;
    }

    private static String localName(Element element) {
        return element.getLocalName() != null ? element.getLocalName() : element.getTagName();
    }

    private static String attribute(Element element, String name) {
        String value = element.getAttribute(name).trim();
        return value.isEmpty() ? null : value;
    }

    private static BigDecimal decimal(Element element) {
        return new BigDecimal(element.getTextContent().trim());
    }

    private static String firstNonNull(String... values) {
        for (String value : values) {
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static void addIfPresent(List<String> parts, String value) {
        if (value != null) {
            parts.add(value);
        }
    }
}
