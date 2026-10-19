import { HttpErrorResponse } from '@angular/common/http';

const GENERIC_SERVER_MESSAGES = new Set(['Internal server error']);

/**
 * Human readable message for a failed HTTP call.
 * The backend answers errors as `{ "error": "..." }` (GlobalExceptionHandler);
 * `message`, `detail` and `title` are accepted for third-party payloads.
 */
export function httpErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    const message = extractMessage(err.error);
    if (message && !GENERIC_SERVER_MESSAGES.has(message)) {
      return message;
    }
  }
  return fallback;
}

export function httpStatus(err: unknown): number | null {
  return err instanceof HttpErrorResponse ? err.status : null;
}

function extractMessage(body: unknown, depth = 0): string | null {
  if (!body || depth > 2) return null;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      return extractMessage(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail', 'title']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (value && typeof value === 'object') {
        const nested = extractMessage(value, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return null;
}

const WEBAUTHN_MESSAGES: Record<string, string> = {
  NotAllowedError: 'Authentication was cancelled or timed out. Try again and approve the request with your passkey (Touch ID, Face ID, Windows Hello or a security key).',
  InvalidStateError: 'A passkey for this account is already registered on this device.',
  NotSupportedError: 'This browser or device does not support passkeys.',
  SecurityError: 'Passkeys are blocked on this page. Open the app on its HTTPS address and try again.',
  AbortError: 'Authentication was interrupted. Please try again.',
};

/**
 * Message for a failed strong customer authentication step (WebAuthn through
 * @adyen/bpscaweb, or the HTTP call around it).
 */
export function scaErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    return httpErrorMessage(err, fallback);
  }
  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && WEBAUTHN_MESSAGES[name]) {
    return WEBAUTHN_MESSAGES[name];
  }
  if ((err as { message?: unknown } | null)?.message === 'TIMEOUT') {
    return 'Authentication timed out. Please try again.';
  }
  if ((err as { code?: unknown } | null)?.code === 'SCA_UNAVAILABLE') {
    return "This browser can't use passkeys. Approve from the browser where you registered your trusted device, or add your phone in Trusted devices.";
  }
  return fallback;
}
