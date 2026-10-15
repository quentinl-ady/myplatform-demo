const KEYWORD_LABELS: Record<string, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
  balance: 'When the balance reaches its threshold',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ALIASES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Human readable label for a transfer or sweep schedule: a keyword ("monthly"), a cron
 * expression ("0 9 5 * *") or an Adyen schedule object ({ type, cronExpression }).
 * Unknown values are returned as they are.
 */
export function describeSchedule(schedule: unknown, keywordLabels: Record<string, string> = {}): string {
  if (schedule && typeof schedule === 'object') {
    const value = schedule as { type?: unknown; cronExpression?: unknown };
    if (typeof value.cronExpression === 'string' && value.cronExpression.trim()) {
      return describeSchedule(value.cronExpression, keywordLabels);
    }
    return typeof value.type === 'string' ? describeSchedule(value.type, keywordLabels) : '—';
  }
  if (typeof schedule !== 'string' || !schedule.trim()) return '—';

  const raw = schedule.trim();
  const keyword = raw.toLowerCase();
  const labels = { ...KEYWORD_LABELS, ...keywordLabels };
  if (labels[keyword]) return labels[keyword];

  return describeCron(raw) ?? raw;
}

function describeCron(expression: string): string | null {
  const fields = expression.split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  const minuteStep = stepOf(minute);
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return minuteStep === 1 ? 'Every minute' : `Every ${minuteStep} minutes`;
  }

  const hourStep = stepOf(hour);
  if (isNumber(minute) && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const past = Number(minute) === 0 ? '' : ` at ${Number(minute)} minutes past`;
    return (hourStep === 1 ? 'Every hour' : `Every ${hourStep} hours`) + past;
  }

  if (!isNumber(minute) || !isNumber(hour)) return null;
  const time = `at ${pad(hour)}:${pad(minute)}`;

  if (dayOfMonth === '*' && month === '*') {
    if (dayOfWeek === '*') return `Every day ${time}`;
    if (dayOfWeek === '1-5' || dayOfWeek.toUpperCase() === 'MON-FRI') return `Every weekday ${time}`;
    const days = parseDays(dayOfWeek);
    return days ? `Every ${joinWords(days)} ${time}` : null;
  }

  if (dayOfWeek === '*' && isNumber(dayOfMonth)) {
    const day = ordinal(Number(dayOfMonth));
    if (month === '*') return `Every month on the ${day} ${time}`;
    if (isNumber(month) && MONTH_NAMES[Number(month) - 1]) {
      return `Every year on ${MONTH_NAMES[Number(month) - 1]} ${Number(dayOfMonth)} ${time}`;
    }
  }
  return null;
}

function stepOf(field: string): number | null {
  if (field === '*') return 1;
  const match = /^\*\/(\d+)$/.exec(field);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

function parseDays(field: string): string[] | null {
  const names: string[] = [];
  for (const part of field.split(',')) {
    const key = part.toLowerCase();
    const index = /^\d$/.test(key) ? Number(key) % 7 : DAY_ALIASES[key];
    if (index === undefined) return null;
    names.push(DAY_NAMES[index]);
  }
  return names;
}

function isNumber(field: string): boolean {
  return /^\d{1,2}$/.test(field);
}

function pad(field: string): string {
  return field.padStart(2, '0');
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
