import { parseServerDate } from '../shared';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return parseServerDate(value);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "15 Oct 2026" */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_FORMAT.format(date) : (typeof value === 'string' && value ? value : '—');
}

/** "15 Oct 2026, 14:05" */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_TIME_FORMAT.format(date) : (typeof value === 'string' && value ? value : '—');
}

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(countryCode: string | null | undefined): string {
  if (!countryCode) return '—';
  try {
    return COUNTRY_NAMES.of(countryCode.toUpperCase()) || countryCode;
  } catch {
    return countryCode;
  }
}

export const SPEED_LABELS: Record<string, string> = {
  regular: 'Regular (1-2 business days)',
  fast: 'Fast (same business day)',
  instant: 'Instant (within seconds)'
};

export function speedLabel(priority: string | null | undefined): string {
  if (!priority) return '—';
  return SPEED_LABELS[priority] ?? priority.charAt(0).toUpperCase() + priority.slice(1);
}
