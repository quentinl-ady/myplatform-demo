package com.myplatform.demo.util;

import com.myplatform.demo.dto.LedgerDTO;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Currency;
import java.util.List;

/**
 * The journal as a CSV file for accounting software: one row per line of entry, the oldest entry first, amounts in
 * major units with a dot.
 */
public final class JournalCsv {

    private static final List<String> HEADER = List.of("Date", "Journal", "Entry", "Account", "Account name", "Partner",
            "Description", "Debit", "Credit", "Currency", "Document", "Reference");
    /** Spreadsheet software runs a cell that starts with one of these as a formula. */
    private static final String FORMULA_STARTS = "=+-@\t\r";

    private JournalCsv() {
    }

    public static byte[] write(List<LedgerDTO.Entry> entries) {
        StringBuilder csv = new StringBuilder("\uFEFF"); // the byte order mark makes Excel read the file as UTF-8
        row(csv, HEADER);
        List<LedgerDTO.Entry> oldestFirst = new ArrayList<>(entries);
        Collections.reverse(oldestFirst);
        oldestFirst.sort(Comparator.comparing(LedgerDTO.Entry::date));
        for (LedgerDTO.Entry entry : oldestFirst) {
            int digits = fractionDigits(entry.currency());
            String reference = entry.transferId() != null ? entry.transferId() : entry.pspReference();
            for (LedgerDTO.Line line : entry.lines()) {
                row(csv, Arrays.asList(entry.date().toString(), entry.journal(), entry.id(), line.account(),
                        line.accountName(), entry.partner(),
                        line.label() != null ? entry.description() + " · " + line.label() : entry.description(),
                        amount(line.debit(), digits), amount(line.credit(), digits), entry.currency(),
                        entry.document(), reference));
            }
        }
        return csv.toString().getBytes(StandardCharsets.UTF_8);
    }

    static String cell(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String text = FORMULA_STARTS.indexOf(value.charAt(0)) >= 0 ? "'" + value : value;
        boolean quoted = text.indexOf(',') >= 0 || text.indexOf('"') >= 0 || text.indexOf('\n') >= 0
                || text.indexOf('\r') >= 0;
        return quoted ? '"' + text.replace("\"", "\"\"") + '"' : text;
    }

    private static void row(StringBuilder csv, List<String> cells) {
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) {
                csv.append(',');
            }
            csv.append(cell(cells.get(i)));
        }
        csv.append("\r\n");
    }

    private static String amount(long minorUnits, int digits) {
        return BigDecimal.valueOf(minorUnits, digits).toPlainString();
    }

    private static int fractionDigits(String currency) {
        try {
            int digits = Currency.getInstance(currency).getDefaultFractionDigits();
            return digits >= 0 ? digits : 2;
        } catch (IllegalArgumentException | NullPointerException e) {
            return 2;
        }
    }
}
