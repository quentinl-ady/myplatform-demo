import { ValidatorFn } from '@angular/forms';

/** A country a cardholder's mobile number can come from. */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code, as in User.countryCode. */
  code: string;
  name: string;
  /** Country calling code, without the plus sign. */
  dialCode: string;
  /** A mobile number in national format without the trunk prefix. Its spaces give the digit grouping. */
  example: string;
  /** Digit counts of a mobile number after the country code. Without it, only loose bounds apply. */
  lengths?: number[];
  /**
   * Dialled before a number inside the country and dropped after the country code. Defaults to 0:
   * countries without a trunk prefix keep the default because their numbers never start with 0.
   */
  trunkPrefix?: string;
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: 'AU', name: 'Australia', dialCode: '61', example: '412 345 678', lengths: [9] },
  { code: 'AT', name: 'Austria', dialCode: '43', example: '664 123456' },
  { code: 'BE', name: 'Belgium', dialCode: '32', example: '470 12 34 56', lengths: [9] },
  { code: 'BR', name: 'Brazil', dialCode: '55', example: '11 96123 4567', lengths: [11] },
  { code: 'BG', name: 'Bulgaria', dialCode: '359', example: '887 123 456' },
  { code: 'CA', name: 'Canada', dialCode: '1', example: '506 234 5678', lengths: [10], trunkPrefix: '1' },
  { code: 'HR', name: 'Croatia', dialCode: '385', example: '92 123 4567', lengths: [8, 9] },
  { code: 'CY', name: 'Cyprus', dialCode: '357', example: '96 123456', lengths: [8] },
  { code: 'CZ', name: 'Czech Republic', dialCode: '420', example: '601 123 456', lengths: [9] },
  { code: 'DK', name: 'Denmark', dialCode: '45', example: '20 12 34 56', lengths: [8] },
  { code: 'EE', name: 'Estonia', dialCode: '372', example: '5123 4567', lengths: [7, 8] },
  { code: 'FI', name: 'Finland', dialCode: '358', example: '41 2345678' },
  { code: 'FR', name: 'France', dialCode: '33', example: '6 12 34 56 78', lengths: [9] },
  { code: 'DE', name: 'Germany', dialCode: '49', example: '1512 3456789', lengths: [10, 11] },
  { code: 'GR', name: 'Greece', dialCode: '30', example: '691 234 5678', lengths: [10] },
  { code: 'HK', name: 'Hong Kong', dialCode: '852', example: '5123 4567', lengths: [8] },
  { code: 'HU', name: 'Hungary', dialCode: '36', example: '20 123 4567', lengths: [9], trunkPrefix: '06' },
  { code: 'IS', name: 'Iceland', dialCode: '354', example: '611 1234', lengths: [7] },
  { code: 'IE', name: 'Ireland', dialCode: '353', example: '85 012 3456', lengths: [9] },
  // Italian numbers keep their leading 0 after +39.
  { code: 'IT', name: 'Italy', dialCode: '39', example: '312 345 6789', lengths: [9, 10], trunkPrefix: '' },
  { code: 'JP', name: 'Japan', dialCode: '81', example: '90 1234 5678', lengths: [10] },
  { code: 'LV', name: 'Latvia', dialCode: '371', example: '21 234 567', lengths: [8] },
  { code: 'LI', name: 'Liechtenstein', dialCode: '423', example: '660 234 567' },
  { code: 'LT', name: 'Lithuania', dialCode: '370', example: '612 34567', lengths: [8] },
  { code: 'LU', name: 'Luxembourg', dialCode: '352', example: '628 123 456', lengths: [9] },
  { code: 'MT', name: 'Malta', dialCode: '356', example: '9696 1234', lengths: [8] },
  { code: 'MX', name: 'Mexico', dialCode: '52', example: '222 123 4567', lengths: [10] },
  { code: 'NL', name: 'Netherlands', dialCode: '31', example: '6 12345678', lengths: [9] },
  { code: 'NO', name: 'Norway', dialCode: '47', example: '406 12 345', lengths: [8] },
  { code: 'PL', name: 'Poland', dialCode: '48', example: '512 345 678', lengths: [9] },
  { code: 'PT', name: 'Portugal', dialCode: '351', example: '912 345 678', lengths: [9] },
  { code: 'RO', name: 'Romania', dialCode: '40', example: '712 034 567', lengths: [9] },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '966', example: '51 234 5678', lengths: [9] },
  { code: 'SG', name: 'Singapore', dialCode: '65', example: '8123 4567', lengths: [8] },
  { code: 'SK', name: 'Slovakia', dialCode: '421', example: '912 123 456', lengths: [9] },
  { code: 'SI', name: 'Slovenia', dialCode: '386', example: '31 234 567', lengths: [8] },
  { code: 'ES', name: 'Spain', dialCode: '34', example: '612 34 56 78', lengths: [9] },
  { code: 'SE', name: 'Sweden', dialCode: '46', example: '70 123 45 67', lengths: [9] },
  { code: 'CH', name: 'Switzerland', dialCode: '41', example: '78 123 45 67', lengths: [9] },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '971', example: '50 123 4567', lengths: [9] },
  { code: 'GB', name: 'United Kingdom', dialCode: '44', example: '7700 900123', lengths: [10] },
  { code: 'US', name: 'United States', dialCode: '1', example: '201 555 0123', lengths: [10], trunkPrefix: '1' },
];

/** Country a pasted number takes when its calling code is shared and the selected country doesn't have it. */
const SHARED_CALLING_CODES: Record<string, string> = { '1': 'US' };

const ALLOWED_CHARACTERS = /^\(?\+?[\d\s().\/-]*$/;
const MIN_DIGITS = 6;
const E164_MAX_DIGITS = 15;

export type PhoneNumberError = 'characters' | 'countryCode' | 'tooShort' | 'tooLong';

export interface ParsedPhoneNumber {
  country: PhoneCountry;
  /** Digits after the country code. */
  nationalNumber: string;
  /** Leading digits of the input that aren't part of the national number: 00, country code, trunk prefix. */
  droppedDigits: number;
  error?: PhoneNumberError;
}

export function findPhoneCountry(code: string | null | undefined): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find(country => country.code === code);
}

/**
 * Reads a mobile number in national format ("06 12 34 56 78") or international format
 * ("+33 6 12 34 56 78", "0033 6…"). A country code in the input wins over the selected country.
 * Returns null for an empty input.
 */
export function parsePhoneNumber(input: string | null | undefined, selected: PhoneCountry): ParsedPhoneNumber | null {
  const text = (input || '').trim();
  if (!text) return null;
  if (!ALLOWED_CHARACTERS.test(text)) {
    return { country: selected, nationalNumber: '', droppedDigits: 0, error: 'characters' };
  }

  const digits = text.replace(/\D/g, '');
  const hasPlus = /^\(?\+/.test(text);
  if (hasPlus || digits.startsWith('00')) {
    const accessCodeLength = hasPlus ? 0 : 2;
    const international = digits.slice(accessCodeLength);
    const country = countryForCallingCode(international, selected);
    if (!country) {
      return { country: selected, nationalNumber: '', droppedDigits: 0, error: 'countryCode' };
    }
    return readNationalNumber(country, international.slice(country.dialCode.length), accessCodeLength + country.dialCode.length);
  }

  const parsed = readNationalNumber(selected, digits, 0);
  // The country code is often typed without + or 00, as in 31612345678.
  if (parsed.error && digits.startsWith(selected.dialCode)) {
    const withoutCode = readNationalNumber(selected, digits.slice(selected.dialCode.length), selected.dialCode.length);
    if (!withoutCode.error) return withoutCode;
  }
  return parsed;
}

/** The E.164 form sent to Adyen, e.g. +31612345678. */
export function toE164(phone: ParsedPhoneNumber): string {
  return `+${phone.country.dialCode}${phone.nationalNumber}`;
}

/** Groups the digits like the country's example number, or leaves them as they are when the lengths differ. */
export function formatNationalNumber(country: PhoneCountry, digits: string): string {
  const groups = country.example.split(' ').map(group => group.length);
  if (groups.reduce((total, size) => total + size, 0) !== digits.length) return digits;
  let start = 0;
  return groups.map(size => digits.slice(start, start += size)).join(' ');
}

/**
 * What the phone field should show once the user is done with it: a country code moves to the
 * country picker, the trunk prefix goes away and a valid number is grouped like the example when
 * it has the same length. Otherwise the user's own spacing stays. Returns null when there's nothing to tidy.
 */
export function tidyPhoneNumber(input: string | null | undefined, selected: PhoneCountry): { country: PhoneCountry; number: string } | null {
  const parsed = parsePhoneNumber(input, selected);
  if (!parsed || parsed.error === 'characters' || parsed.error === 'countryCode') return null;
  const fitsExample = parsed.country.example.replace(/\D/g, '').length === parsed.nationalNumber.length;
  const number = !parsed.error && fitsExample
    ? formatNationalNumber(parsed.country, parsed.nationalNumber)
    : dropLeadingDigits((input || '').trim(), parsed.droppedDigits);
  return { country: parsed.country, number };
}

/** Validates a mobile number control against the country selected in a sibling control. */
export function mobileNumberValidator(countryControlName: string): ValidatorFn {
  return control => {
    const country = findPhoneCountry(control.parent?.get(countryControlName)?.value);
    const parsed = country ? parsePhoneNumber(control.value, country) : null;
    return parsed?.error ? { mobileNumber: parsed } : null;
  };
}

// E.164 calling codes are prefix-free, so the shortest match is the only one.
function countryForCallingCode(digits: string, selected: PhoneCountry): PhoneCountry | undefined {
  for (let length = 1; length <= 3; length++) {
    const code = digits.slice(0, length);
    const matches = PHONE_COUNTRIES.filter(country => country.dialCode === code);
    if (matches.length) {
      return matches.find(country => country.code === selected.code)
        ?? matches.find(country => country.code === SHARED_CALLING_CODES[code])
        ?? matches[0];
    }
  }
  return undefined;
}

function readNationalNumber(country: PhoneCountry, digits: string, droppedDigits: number): ParsedPhoneNumber {
  const trunkPrefix = country.trunkPrefix ?? '0';
  if (trunkPrefix && digits.startsWith(trunkPrefix)) {
    digits = digits.slice(trunkPrefix.length);
    droppedDigits += trunkPrefix.length;
  }
  const lengths = country.lengths;
  const min = lengths ? Math.min(...lengths) : MIN_DIGITS;
  const valid = lengths
    ? lengths.includes(digits.length)
    : digits.length >= MIN_DIGITS && digits.length <= E164_MAX_DIGITS - country.dialCode.length;
  const error = valid ? undefined : digits.length < min ? 'tooShort' : 'tooLong';
  return { country, nationalNumber: digits, droppedDigits, error };
}

// Keeps the rest of the input as typed, minus the separators left in front of it.
function dropLeadingDigits(input: string, count: number): string {
  if (count === 0) return input;
  let index = 0;
  for (let seen = 0; index < input.length && seen < count; index++) {
    if (input[index] >= '0' && input[index] <= '9') seen++;
  }
  return input.slice(index).replace(/^\D+/, '');
}
