package com.myplatform.demo.util;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the name Adyen gives to an account statement, such as
 * CAMT053_BA3299F22322C95PRQL2J45ZT_20261019010000_20261020005959_EUR.xml:
 * balance account, start and end of the period (yyyyMMddHHmmss), currency.
 */
public final class AccountStatementFile {

    private static final Pattern PERIOD = Pattern.compile("_(\\d{14})_(\\d{14})_");
    private static final Pattern CURRENCY = Pattern.compile("_([A-Z]{3})\\.xml$");
    private static final DateTimeFormatter TIMESTAMP = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private AccountStatementFile() {
    }

    /** The days a statement covers, both included. */
    public record Period(LocalDate firstDay, LocalDate lastDay) {

        /** "19 Oct 2026", or "1 Oct 2026 – 31 Oct 2026" */
        public String label() {
            return firstDay.equals(lastDay) ? DAY.format(firstDay) : DAY.format(firstDay) + " – " + DAY.format(lastDay);
        }
    }

    /** The statements and the other reports of the balance platform come with the same webhook. */
    public static boolean isStatement(String fileName, String downloadUrl) {
        return (fileName != null && fileName.startsWith("CAMT053_"))
                || (downloadUrl != null && downloadUrl.contains("/reportDownload/statements/"));
    }

    /** "EUR", or null when the name doesn't end with a currency. */
    public static String currency(String fileName) {
        if (fileName == null) return null;
        Matcher matcher = CURRENCY.matcher(fileName);
        return matcher.find() ? matcher.group(1) : null;
    }

    /**
     * The name of the PDF: account-statement_2026-10-19_EUR.pdf for a day,
     * account-statement_2026-10-01_2026-10-31_EUR.pdf for a longer period.
     */
    public static String pdfName(String fileName) {
        Period period = period(fileName);
        if (period == null) return fileName.replaceFirst("(?i)\\.xml$", "") + ".pdf";
        String days = period.firstDay().equals(period.lastDay())
                ? period.firstDay().toString()
                : period.firstDay() + "_" + period.lastDay();
        String currency = currency(fileName);
        return "account-statement_" + days + (currency != null ? "_" + currency : "") + ".pdf";
    }

    /**
     * The period doesn't always start at midnight: 20261019010000_20261020005959 covers 19 Oct.
     * The end is moved back by the start hour, so that a daily statement covers a single day.
     * Null when the name has no period.
     */
    public static Period period(String fileName) {
        if (fileName == null) return null;
        Matcher matcher = PERIOD.matcher(fileName);
        if (!matcher.find()) return null;
        try {
            LocalDateTime start = LocalDateTime.parse(matcher.group(1), TIMESTAMP);
            LocalDateTime end = LocalDateTime.parse(matcher.group(2), TIMESTAMP);
            Duration startHour = Duration.between(start.toLocalDate().atStartOfDay(), start);
            LocalDate firstDay = start.toLocalDate();
            LocalDate lastDay = end.minus(startHour).toLocalDate();
            return lastDay.isBefore(firstDay) ? null : new Period(firstDay, lastDay);
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
