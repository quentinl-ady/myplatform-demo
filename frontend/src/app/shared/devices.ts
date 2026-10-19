import { Device, DeviceKind } from '../models';

/** What this browser runs on. iPadOS presents itself as a Mac: its touch screen tells them apart. */
export function currentDeviceKind(): DeviceKind {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/iPhone|iPod/.test(ua)) return 'phone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
  return /Mobi|Windows Phone/.test(ua) ? 'phone' : 'computer';
}

/** e.g. "iPhone · Safari", "Mac · Chrome", "Windows · Edge" */
export function currentPlatformLabel(): string {
  const ua = navigator.userAgent;
  const kind = currentDeviceKind();
  const system =
    /iPhone|iPod/.test(ua) ? 'iPhone'
    : kind === 'tablet' && /iPad|Macintosh/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? (kind === 'phone' ? 'Android phone' : 'Android tablet')
    : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : kind === 'phone' ? 'Phone' : kind === 'tablet' ? 'Tablet' : 'Computer';
  const browser =
    /Edg(A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  return browser ? `${system} · ${browser}` : system;
}

/** Whether this browser can create and use a passkey unlocked by the device itself, as @adyen/bpscaweb requires. */
export async function platformPasskeysAvailable(): Promise<boolean> {
  try {
    return typeof PublicKeyCredential !== 'undefined'
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Adyen links up to 5 SCA devices to a bank account. */
export const MAX_TRUSTED_DEVICES = 5;

/** A phone or tablet of another kind than this device can't be this browser: it approves by scanning a QR code. */
export function approvesWithQrCode(device: Device): boolean {
  const current = currentDeviceKind();
  return (device.kind === 'phone' || device.kind === 'tablet') && device.kind !== current;
}

/** Where an operation is approved: with a passkey in this browser, or on a phone that scans a QR code. */
export type ApprovalMode = 'here' | 'phone';

export interface ApprovalChoice {
  mode: ApprovalMode;
  /** Both ways are possible, so the page offers the other one. */
  canSwitch: boolean;
}

const approvalModeKey = (userId: string) => `approval-mode:${userId}`;

/**
 * How this browser approves operations with these trusted devices. Approving here needs passkeys in
 * this browser. When both ways are possible, the last choice made in this browser wins; without one,
 * a device registered from the same kind of browser is probably this one.
 */
export async function approvalChoice(devices: Device[] | null | undefined, userId: string): Promise<ApprovalChoice> {
  const all = devices ?? [];
  const phones = all.filter(approvesWithQrCode);
  if (!phones.length) return { mode: 'here', canSwitch: false };
  if (phones.length === all.length || !await platformPasskeysAvailable()) return { mode: 'phone', canSwitch: false };

  let saved: string | null = null;
  try {
    saved = localStorage.getItem(approvalModeKey(userId));
  } catch {
    // Storage blocked: fall back to the guess.
  }
  if (saved === 'here' || saved === 'phone') return { mode: saved, canSwitch: true };
  const platform = currentPlatformLabel();
  const sameBrowser = all.some(device => !approvesWithQrCode(device) && device.platform === platform);
  return { mode: sameBrowser ? 'here' : 'phone', canSwitch: true };
}

export function saveApprovalMode(userId: string, mode: ApprovalMode) {
  try {
    localStorage.setItem(approvalModeKey(userId), mode);
  } catch {
    // Storage blocked: the choice only lasts for this page.
  }
}

/** The page the phone opens. The token stays in the fragment, which browsers never send to servers. */
export function remoteLink(token: string): string {
  return new URL(`continue#${token}`, document.baseURI).toString();
}

/**
 * Why a phone can't use the link to this page, if it can't: it must reach this address, and
 * passkeys only work on HTTPS.
 */
export function remoteLinkProblem(): string | null {
  const host = window.location.hostname;
  if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(host) || host.endsWith('.local')) {
    return "Your phone can't open this address: the app runs on this computer. Open the app on its public HTTPS address to use your phone.";
  }
  if (window.location.protocol !== 'https:') {
    return 'Passkeys only work on a secure address. Open the app on its HTTPS address to use your phone.';
  }
  return null;
}

/** The browser refused to use the passkey: the prompt was dismissed, or it needs a fresh tap first. */
export function isPasskeyRefused(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'NotAllowedError';
}
