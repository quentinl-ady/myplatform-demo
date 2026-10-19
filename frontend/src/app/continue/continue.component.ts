import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EMPTY, Subscription, catchError, exhaustMap, firstValueFrom, timer } from 'rxjs';
import ScaWebauthn from '@adyen/bpscaweb';

import { PhoneSession, RemoteSessionStatus } from '../models';
import { RemoteSessionService } from '../services';
import {
  MoneyPipe, currentDeviceKind, currentPlatformLabel, httpErrorMessage, httpStatus, isPasskeyRefused,
  platformPasskeysAvailable, scaErrorMessage
} from '../shared';
import { DEFAULT_PLATFORM_NAME, PageTitleStrategy } from '../layout/page-title.strategy';
import { DetailRow, bankDetailRows } from '../banktransfer/bank-details';
import { countryName, speedLabel } from '../banktransfer/format-date';
import { STANDING_ORDER_SCHEDULES, describeSchedule } from '../banktransfer/schedule-label';

const POLL_MS = 3000;

/**
 * loading: the link is being opened; ready: the request is shown; working: a step runs;
 * confirm: the passkey needs a tap of its own; done: completed; ended: declined, cancelled,
 * expired or invalid.
 */
type Stage = 'loading' | 'ready' | 'working' | 'confirm' | 'done' | 'ended';

/** A use of the passkey the browser refused without a fresh tap, or that the user dismissed. */
type PasskeyStep = 'register' | 'associate' | 'authenticate';

interface BatchLine {
  counterpartyName: string;
  amount: number;
  currency: string;
  reference: string;
}

const TITLES: Record<string, string> = {
  pairing: 'Register this phone',
  transfer: 'Approve this transfer',
  standingOrder: 'Approve this scheduled transfer',
  batch: 'Approve these transfers',
  transactions: 'Show your transactions'
};

const DONE: Record<string, { title: string; text: string }> = {
  pairing: {
    title: 'This phone is registered',
    text: 'To approve with this phone, scan the QR code your computer shows. You can close this page.'
  },
  transfer: { title: 'Transfer approved', text: 'You can close this page and go back to your computer.' },
  standingOrder: { title: 'Scheduled transfer approved', text: 'You can close this page and go back to your computer.' },
  batch: { title: 'Transfers approved', text: 'You can close this page and go back to your computer.' },
  transactions: { title: 'Access allowed', text: 'Your transactions now appear on your computer. You can close this page.' }
};

/**
 * The page a phone opens from the QR code shown on the computer: it registers the phone as
 * trusted device, or approves an operation with the passkey of the phone.
 */
@Component({
  selector: 'app-continue',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, MoneyPipe],
  templateUrl: './continue.component.html',
  styleUrl: './continue.component.css'
})
export class ContinueComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private remoteSessions = inject(RemoteSessionService);
  private pageTitle = inject(PageTitleStrategy);
  private sca = ScaWebauthn.create({ relyingPartyName: 'myplatform' });

  private token = '';
  /** What checkAvailability returns: Adyen needs it to prepare the passkey of this phone. */
  private availability = '';
  private registered = false;
  private pending: { step: PasskeyStep; sdkInput: string } | null = null;
  private fragmentChanges?: Subscription;
  private poll?: Subscription;
  private ticker: ReturnType<typeof setInterval> | null = null;

  readonly label = currentPlatformLabel();
  /** The name the server gives this phone when none was entered on the computer. */
  readonly defaultName = `My ${this.label.split(' · ')[0]}`;
  readonly canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;

  stage = signal<Stage>('loading');
  session = signal<PhoneSession | null>(null);
  /** Whether this browser can use a passkey; null while it is checked. */
  passkeys = signal<boolean | null>(null);
  status = signal('');
  error = signal('');
  endTitle = signal('');
  endText = signal('');
  copied = signal(false);
  pendingStep = signal<PasskeyStep | null>(null);
  logoFailed = signal(false);
  private expiresAt = signal(0);
  private now = signal(Date.now());

  readonly type = computed(() => this.session()?.type ?? '');
  readonly summary = computed<Record<string, any>>(() => this.session()?.summary ?? {});
  readonly platformName = computed(() => this.session()?.platformName || DEFAULT_PLATFORM_NAME);
  readonly logo = computed(() => (!this.logoFailed() && this.session()?.logoData) || 'assets/logo.svg');
  readonly title = computed(() => TITLES[this.type()] ?? 'Continue on your phone');
  readonly done = computed(() => DONE[this.type()] ?? { title: 'Done', text: 'You can close this page.' });
  readonly countdown = computed(() => {
    const seconds = Math.max(0, Math.ceil((this.expiresAt() - this.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  readonly bankRows = computed<DetailRow[]>(() => bankDetailRows(this.summary()['bankAccount'] ?? {}));
  readonly batchLines = computed<BatchLine[]>(() => this.summary()['transfers'] ?? []);
  readonly batchTotals = computed<{ amount: number; currency: string }[]>(() => this.summary()['totals'] ?? []);

  readonly countryName = countryName;
  readonly speedLabel = speedLabel;

  async ngOnInit() {
    this.token = (this.route.snapshot.fragment || '').trim();
    // A new QR code may open in this same tab: only the fragment changes then, and the page must start over with it.
    this.fragmentChanges = this.route.fragment.subscribe(fragment => {
      if ((fragment || '').trim() !== this.token) window.location.reload();
    });
    if (!this.token) {
      this.end('This link is incomplete', 'Scan the QR code on your computer again.');
      return;
    }

    const available = await platformPasskeysAvailable();
    if (available) {
      try {
        this.availability = String(await this.sca.checkAvailability());
      } catch {
        this.availability = '';
      }
    }
    this.passkeys.set(!!this.availability);

    try {
      const session = await firstValueFrom(this.remoteSessions.open(this.token, this.label, !!this.availability));
      this.session.set(session);
      this.pageTitle.setPlatformName(session.platformName);
      this.pageTitle.setPageTitle(this.title());
      this.apply(session);
    } catch (err) {
      this.failToOpen(err);
    }
  }

  ngOnDestroy() {
    this.fragmentChanges?.unsubscribe();
    this.stopWatching();
  }

  get confirmText(): string {
    switch (this.pendingStep()) {
      case 'register': return 'Your phone needs a tap to create the passkey. Tap Continue, then confirm with Face ID, your fingerprint or your screen lock.';
      case 'associate': return 'One more confirmation links this phone to your bank account. Tap Continue, then confirm with your passkey.';
      default: return 'Tap Continue, then confirm with Face ID, your fingerprint or your screen lock.';
    }
  }

  get primaryText(): string {
    switch (this.type()) {
      case 'pairing': return 'Create passkey';
      case 'batch': return 'Approve all';
      case 'transactions': return 'Allow';
      default: return 'Approve';
    }
  }

  scheduleLabel(schedule: unknown): string {
    return describeSchedule(schedule, STANDING_ORDER_SCHEDULES);
  }

  /** Runs on the tap of the primary button: the first use of the passkey follows it as closely as possible. */
  async approve() {
    if (this.stage() !== 'ready' || !this.availability) return;
    this.begin();
    try {
      if (this.type() === 'pairing') {
        await this.runPairing();
      } else {
        await this.runApproval();
      }
    } catch (err) {
      this.fail(err);
    }
  }

  /** The passkey is called before anything is awaited, so that the browser still sees the tap. */
  async continuePending() {
    const pending = this.pending;
    if (this.stage() !== 'confirm' || !pending) return;
    this.begin();
    try {
      const output = await this.usePasskey(pending.step, pending.sdkInput);
      if (output !== null) {
        await this.afterPasskey(pending.step, output);
      }
    } catch (err) {
      this.fail(err);
    }
  }

  async decline() {
    if (this.stage() === 'working' || this.stage() === 'loading') return;
    this.error.set('');
    try {
      const session = await firstValueFrom(this.remoteSessions.decline(this.token));
      this.apply(session);
    } catch (err) {
      this.error.set(httpErrorMessage(err, "Couldn't decline the request. Try again."));
    }
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.copied.set(false);
    }
  }

  // ---- Steps ----

  private async runPairing() {
    if (this.registered) {
      await this.associate();
      return;
    }
    this.status.set('Preparing your passkey...');
    const response = await firstValueFrom(this.remoteSessions.register(this.token, this.availability));
    const output = await this.usePasskey('register', response.sdkInput!);
    if (output !== null) {
      await this.afterPasskey('register', output);
    }
  }

  private async associate() {
    this.status.set('Linking this phone to your bank account...');
    const response = await firstValueFrom(this.remoteSessions.associate(this.token));
    const output = await this.usePasskey('associate', response.sdkInput!);
    if (output !== null) {
      await this.afterPasskey('associate', output);
    }
  }

  private async runApproval() {
    this.status.set('Preparing the approval...');
    const response = await firstValueFrom(this.remoteSessions.challenge(this.token, this.availability));
    if (response.status === 'completed') {
      this.finish();
      return;
    }
    const output = await this.usePasskey('authenticate', response.authParam1!);
    if (output !== null) {
      await this.afterPasskey('authenticate', output);
    }
  }

  private async afterPasskey(step: PasskeyStep, output: string) {
    this.pending = null;
    this.pendingStep.set(null);
    if (step === 'register') {
      this.status.set('Registering this phone...');
      const response = await firstValueFrom(
        this.remoteSessions.finalizeRegistration(this.token, output, currentDeviceKind(), this.label)
      );
      this.registered = true;
      if (response.associationRequired) {
        await this.associate();
        return;
      }
    } else if (step === 'associate') {
      this.status.set('Linking this phone to your bank account...');
      await firstValueFrom(this.remoteSessions.finalizeAssociation(this.token, output));
    } else {
      this.status.set('Approving...');
      await firstValueFrom(this.remoteSessions.approve(this.token, output));
    }
    this.finish();
  }

  /**
   * Null when the browser refused the passkey: Safari does so without a fresh tap, and the user
   * may have dismissed the prompt. A Continue button then calls it again directly.
   */
  private async usePasskey(step: PasskeyStep, sdkInput: string): Promise<string | null> {
    this.status.set(step === 'register' ? 'Creating your passkey...' : 'Waiting for your passkey...');
    try {
      const output = step === 'register' ? await this.sca.register(sdkInput) : await this.sca.authenticate(sdkInput);
      return String(output);
    } catch (err) {
      if (!isPasskeyRefused(err)) throw err;
      this.pending = { step, sdkInput };
      this.pendingStep.set(step);
      this.stage.set('confirm');
      return null;
    }
  }

  private begin() {
    this.stage.set('working');
    this.error.set('');
  }

  private finish() {
    this.stopWatching();
    this.stage.set('done');
  }

  private fail(err: unknown) {
    const status = httpStatus(err);
    if (status === 404) {
      this.failToOpen(err);
      return;
    }
    this.error.set(scaErrorMessage(err, 'Something went wrong. Try again.'));
    if (status === 409) {
      this.refresh();
    }
    this.stage.set(this.pending ? 'confirm' : 'ready');
  }

  private failToOpen(err: unknown) {
    const status = httpStatus(err);
    if (status === 0) {
      this.end("Couldn't reach the server", 'Check the connection of your phone, then scan the QR code again.');
    } else if (status !== null && status !== 404) {
      this.end("Couldn't open this request", httpErrorMessage(err, 'Something went wrong. Scan the QR code again.'));
    } else {
      this.end('This link is no longer valid', 'Start again on your computer, then scan the new QR code.');
    }
  }

  // ---- Status ----

  private apply(session: PhoneSession) {
    this.session.update(current => ({ ...current, ...session, summary: session.summary ?? current?.summary }));
    this.expiresAt.set(Date.now() + Math.max(0, session.secondsLeft) * 1000);
    this.now.set(Date.now());
    if (session.status === 'completed') {
      this.finish();
    } else if (this.isFinal(session.status)) {
      this.endFor(session.status);
    } else {
      if (this.stage() === 'loading') this.stage.set('ready');
      this.watch();
    }
  }

  private endFor(status: RemoteSessionStatus) {
    switch (status) {
      case 'declined':
        this.end('Request declined', 'Nothing was done. You can close this page.');
        break;
      case 'cancelled':
        this.end('Request cancelled', 'It was cancelled on your computer, or a newer request replaced it. Scan the new QR code to continue.');
        break;
      default:
        this.end('Request expired', 'Start again on your computer, then scan the new QR code.');
    }
  }

  private end(title: string, text: string) {
    this.stopWatching();
    this.pending = null;
    this.pendingStep.set(null);
    this.endTitle.set(title);
    this.endText.set(text);
    this.stage.set('ended');
  }

  private isFinal(status: RemoteSessionStatus): boolean {
    return status === 'completed' || status === 'declined' || status === 'cancelled' || status === 'expired';
  }

  private refresh() {
    this.remoteSessions.phoneStatus(this.token).subscribe({
      next: (session) => this.apply(session),
      error: () => undefined
    });
  }

  /** Follows the request while the user reads it: the computer may cancel it, or it may expire. */
  private watch() {
    if (this.poll) return;
    this.poll = timer(POLL_MS, POLL_MS).pipe(
      exhaustMap(() => this.remoteSessions.phoneStatus(this.token).pipe(
        catchError((err) => {
          if (httpStatus(err) === 404) this.failToOpen(err);
          return EMPTY;
        })
      ))
    ).subscribe((session) => {
      if (this.stage() !== 'working') this.apply(session);
    });
    this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopWatching() {
    this.poll?.unsubscribe();
    this.poll = undefined;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}
