import { AccountStatement } from '../models';
import { formatDate, formatDateTime } from './dates';

export type StatementFormat = 'pdf' | 'xml';

/** "19 Oct 2026" for a daily statement, "1 Oct 2026 – 31 Oct 2026" for a longer period. */
export function statementPeriod(statement: AccountStatement): string {
  if (!statement.periodStart || !statement.periodEnd) {
    return formatDateTime(statement.creationDate);
  }
  const start = formatDate(statement.periodStart);
  return statement.periodStart === statement.periodEnd ? start : `${start} – ${formatDate(statement.periodEnd)}`;
}

/** The CAMT.053 file keeps the name Adyen gave it. */
export function statementFileName(statement: AccountStatement, format: StatementFormat): string {
  if (format === 'pdf') return statement.pdfFileName;
  return /\.xml$/i.test(statement.fileName) ? statement.fileName : `${statement.fileName}.xml`;
}

/** "Download the EUR statement for 19 Oct 2026 as a PDF" */
export function statementDownloadLabel(statement: AccountStatement, format: StatementFormat): string {
  const currency = statement.currency ? `${statement.currency} ` : '';
  const as = format === 'pdf' ? 'as a PDF' : 'as a CAMT.053 XML file';
  return `Download the ${currency}statement for ${statementPeriod(statement)} ${as}`;
}
