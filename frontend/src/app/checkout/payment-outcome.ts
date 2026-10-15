import { HttpErrorResponse } from '@angular/common/http';
import { httpErrorMessage } from '../shared';

export type PaymentOutcomeKind = 'success' | 'pending' | 'refused' | 'cancelled' | 'error';

export interface PaymentOutcome {
  kind: PaymentOutcomeKind;
  title: string;
  message: string;
  resultCode?: string;
  refusalReason?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  pspReference?: string;
}

/** What the shopper was asked to pay, captured when the session is created. Amount in minor units. */
export interface PaymentContext {
  amount?: number;
  currency?: string;
  reference?: string;
}

export interface PaymentResultExtras {
  refusalReason?: string;
  pspReference?: string;
}

/** Reads optional fields that Adyen may add to a Drop-in result object. */
export function resultExtras(result: unknown): PaymentResultExtras {
  if (!result || typeof result !== 'object') return {};
  const record = result as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    refusalReason: text(record['refusalReason']),
    pspReference: text(record['pspReference']),
  };
}

export function describePaymentResult(
  resultCode: string | undefined,
  context: PaymentContext,
  extras: PaymentResultExtras = {},
): PaymentOutcome {
  const base = { ...context, ...extras, resultCode };
  switch (resultCode) {
    case 'Authorised':
      return { ...base, kind: 'success', title: 'Payment authorised', message: 'The payment was approved.' };
    case 'PartiallyAuthorised':
      return { ...base, kind: 'success', title: 'Payment partially authorised', message: 'Only part of the amount was approved.' };
    case 'Pending':
    case 'Received':
      return {
        ...base,
        kind: 'pending',
        title: resultCode === 'Pending' ? 'Payment pending' : 'Payment received',
        message: 'The final result is confirmed asynchronously. Check the Transactions page in a few minutes.',
      };
    case 'Refused':
      return {
        ...base,
        kind: 'refused',
        title: 'Payment refused',
        message: extras.refusalReason
          ? 'The payment was refused. Try another card or payment method.'
          : 'The payment was refused by the issuer or by risk checks. Try another card or payment method.',
      };
    case 'Cancelled':
      return { ...base, kind: 'cancelled', title: 'Payment cancelled', message: 'The payment was cancelled before it was completed.' };
    default:
      return {
        ...base,
        kind: 'error',
        title: 'Payment failed',
        message: 'Something went wrong while processing the payment. Try again.',
      };
  }
}

export function describeTokenizationResult(
  resultCode: string | undefined,
  context: PaymentContext,
  extras: PaymentResultExtras = {},
): PaymentOutcome {
  const base = { currency: context.currency, reference: context.reference, ...extras, resultCode };
  switch (resultCode) {
    case 'Authorised':
      return {
        ...base,
        kind: 'success',
        title: 'Card saved',
        message: 'The card was verified with a zero-amount authorisation and saved for future payments.',
      };
    case 'Pending':
    case 'Received':
      return {
        ...base,
        kind: 'pending',
        title: 'Card verification pending',
        message: 'The card will appear in your saved cards once the verification is confirmed.',
      };
    case 'Refused':
      return { ...base, kind: 'refused', title: 'Card not saved', message: 'The card verification was refused. Try another card.' };
    case 'Cancelled':
      return { ...base, kind: 'cancelled', title: 'Card not saved', message: 'The card verification was cancelled.' };
    default:
      return { ...base, kind: 'error', title: 'Card not saved', message: 'Something went wrong while saving the card. Try again.' };
  }
}

export function errorOutcome(title: string, message: string, context: PaymentContext = {}): PaymentOutcome {
  return { ...context, kind: 'error', title, message };
}

/**
 * Outcome shown when the Drop-in can't be loaded. Adyen Web error messages are written for developers
 * (request URL, client key), so only the error type is used to choose the text.
 */
export function dropinLoadFailure(error: unknown, form: 'payment form' | 'card form', context: PaymentContext = {}): PaymentOutcome {
  const title = `Couldn't load the ${form}`;
  if (error instanceof HttpErrorResponse) {
    return errorOutcome(title, httpErrorMessage(error, 'Try again in a moment.'), context);
  }
  const unreachable = (error as { name?: unknown } | null)?.name === 'NETWORK_ERROR';
  return errorOutcome(
    title,
    unreachable
      ? 'The payment service could not be reached. Check your connection and try again.'
      : 'The payment service returned an error. Try again in a moment.',
    context,
  );
}
