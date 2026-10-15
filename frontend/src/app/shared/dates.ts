const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
});

/**
 * Parses a backend timestamp. Current values are ISO-8601 UTC ("...Z"). Backends that predate
 * the zone suffix send the server clock without a zone; the hosted backend runs in UTC, so
 * those values are read as UTC too (same rule as the API Explorer).
 */
export function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let normalized = value.trim().replace(' ', 'T');
  // Java emits up to nanoseconds; Safari only parses up to milliseconds.
  normalized = normalized.replace(/(\.\d{3})\d+/, '$1');
  const hasTime = normalized.includes('T');
  if (hasTime && !/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    normalized += 'Z';
  }
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return null;
  if (!hasTime) {
    // Date-only strings are parsed as UTC by the spec; keep them on the local calendar day.
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return date;
}

/** "15 Oct 2026, 14:05" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parseServerDate(value);
  return date ? DATE_TIME_FORMAT.format(date) : '';
}

/** "Just now", "5 min ago", "3 hours ago", "2 days ago", then "15 Oct 2026". */
export function formatTimeAgo(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = value instanceof Date ? value : parseServerDate(value);
  if (!date) return '';
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
  return DATE_FORMAT.format(date);
}
