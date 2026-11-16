package com.myplatform.demo.util;

import com.myplatform.demo.dto.LedgerDTO;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class JournalCsvTest {

    @Test
    void writesOneRowPerLineTheOldestEntryFirst() {
        LedgerDTO.Entry invoice = entry("SAL-INV-2026-0001", LocalDate.of(2026, 11, 1), "EUR", "Invoice INV-2026-0001",
                "Acme", List.of(new LedgerDTO.Line("1100", "Accounts receivable", null, 120_000, 0),
                        new LedgerDTO.Line("4000", "Sales", null, 0, 100_000),
                        new LedgerDTO.Line("2200", "VAT payable", "VAT 20%", 0, 20_000)));
        LedgerDTO.Entry payment = entry("BNK-T1", LocalDate.of(2026, 11, 2), "EUR", "Payment · INV-2026-0001", "Acme",
                List.of(new LedgerDTO.Line("1201", "Balance account · Main", null, 120_000, 0),
                        new LedgerDTO.Line("1100", "Accounts receivable", null, 0, 120_000)));

        String csv = new String(JournalCsv.write(List.of(payment, invoice)), StandardCharsets.UTF_8);

        assertThat(csv).startsWith("\uFEFF");
        assertThat(csv.substring(1).split("\r\n")).containsExactly(
                "Date,Journal,Entry,Account,Account name,Partner,Description,Debit,Credit,Currency,Document,Reference",
                "2026-11-01,BNK,SAL-INV-2026-0001,1100,Accounts receivable,Acme,Invoice INV-2026-0001,1200.00,0.00,EUR,INV-2026-0001,T1",
                "2026-11-01,BNK,SAL-INV-2026-0001,4000,Sales,Acme,Invoice INV-2026-0001,0.00,1000.00,EUR,INV-2026-0001,T1",
                "2026-11-01,BNK,SAL-INV-2026-0001,2200,VAT payable,Acme,Invoice INV-2026-0001 · VAT 20%,0.00,200.00,EUR,INV-2026-0001,T1",
                "2026-11-02,BNK,BNK-T1,1201,Balance account · Main,Acme,Payment · INV-2026-0001,1200.00,0.00,EUR,INV-2026-0001,T1",
                "2026-11-02,BNK,BNK-T1,1100,Accounts receivable,Acme,Payment · INV-2026-0001,0.00,1200.00,EUR,INV-2026-0001,T1");
    }

    @Test
    void amountsUseTheDecimalsOfTheCurrency() {
        LedgerDTO.Entry entry = entry("BNK-T1", LocalDate.of(2026, 11, 2), "JPY", "Payment", null,
                List.of(new LedgerDTO.Line("1201", "Balance account · Main", null, 1_200, 0)));

        String csv = new String(JournalCsv.write(List.of(entry)), StandardCharsets.UTF_8);

        assertThat(csv).contains(",1200,0,JPY,");
    }

    @Test
    void cellsAreQuotedAndFormulasDisarmed() {
        assertThat(JournalCsv.cell("Smith, Jones & Co")).isEqualTo("\"Smith, Jones & Co\"");
        assertThat(JournalCsv.cell("The \"best\" shop")).isEqualTo("\"The \"\"best\"\" shop\"");
        assertThat(JournalCsv.cell("=HYPERLINK(\"http://x\")")).isEqualTo("\"'=HYPERLINK(\"\"http://x\"\")\"");
        assertThat(JournalCsv.cell("-5")).isEqualTo("'-5");
        assertThat(JournalCsv.cell(null)).isEmpty();
    }

    private static LedgerDTO.Entry entry(String id, LocalDate date, String currency, String description,
                                         String partner, List<LedgerDTO.Line> lines) {
        return new LedgerDTO.Entry(id, date, "BNK", "PAYMENT", "MATCHED", description, partner, "INV-2026-0001", 1L,
                null, "T1", null, "BA1", currency, lines.stream().mapToLong(LedgerDTO.Line::debit).sum(), null, lines);
    }
}
