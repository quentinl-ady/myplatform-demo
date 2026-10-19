import { ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { RemoteSessionPanelComponent } from '../remote-session/remote-session-panel.component';

import { Device, DeviceKind, RemoteSession } from '../models';
import { RemoteSessionService, TransferService } from '../services';
import {
  MAX_TRUSTED_DEVICES, currentDeviceKind, currentPlatformLabel, httpErrorMessage, httpStatus, platformPasskeysAvailable,
  saveApprovalMode, scaErrorMessage
} from '../shared';
import { firstValueFrom } from 'rxjs';
import ScaWebauthn from '@adyen/bpscaweb';

const INVALID_CODE_MESSAGE = 'This verification code is invalid or has expired. Check the code or send a new one.';

const KIND_NAMES: Record<DeviceKind, string> = { computer: 'computer', tablet: 'tablet', phone: 'phone' };
const KIND_ICONS: Record<DeviceKind, string> = { computer: 'laptop', tablet: 'tablet_mac', phone: 'smartphone' };

/** Where the passkey is created: in this browser, or on a phone that scans a QR code. */
export type RegistrationTarget = 'this' | 'phone';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('TIMEOUT'));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

let nextRegistrationId = 0;

@Component({
  selector: 'app-device-registration',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule,
    RemoteSessionPanelComponent
  ],
  template: `
    <mat-card class="action-card">
      <div class="action-header">
        <h3>{{ devices.length ? 'Add another trusted device' : 'Add a trusted device' }}</h3>
        <p *ngIf="step() !== 'qr'">You approve transfers with a passkey on any of your trusted devices: Face ID, Touch ID, Windows Hello or the screen lock of your phone. You can register up to {{ maxDevices }} devices.</p>
        <p *ngIf="step() === 'qr'">Your phone creates its passkey. Keep this page open until it is done.</p>
      </div>

      <div class="limit-notice" *ngIf="step() === 'name' && atLimit" role="status">
        <mat-icon aria-hidden="true">info_outline</mat-icon>
        <span>You have {{ devices.length }} trusted devices, the maximum for this account. Remove one to add another device.</span>
      </div>

      <!-- Step 1: where, device name, then request OTP -->
      <form class="setup-form" *ngIf="step() === 'name' && !atLimit" (ngSubmit)="requestOtp()">
        <fieldset class="choices" *ngIf="canUsePhone">
          <legend class="choices-legend">Device to approve transfers with</legend>
          <label class="choice" [class.selected]="target() === 'this'" [class.disabled]="passkeys() === false">
            <input type="radio" [name]="ids.target" value="this" [checked]="target() === 'this'"
                   [disabled]="passkeys() === false" (change)="choose('this')" />
            <mat-icon class="choice-icon" aria-hidden="true">{{ thisIcon }}</mat-icon>
            <span class="choice-text">
              <span class="choice-title">
                This {{ thisName }}
                <span class="choice-badge" *ngIf="recommended === 'this'">Recommended</span>
              </span>
              <span class="choice-hint">
                {{ passkeys() === false
                  ? "Passkeys aren't available in this browser."
                  : 'Approve in this browser with Touch ID, Face ID or Windows Hello.' }}
              </span>
            </span>
          </label>
          <label class="choice" [class.selected]="target() === 'phone'">
            <input type="radio" [name]="ids.target" value="phone" [checked]="target() === 'phone'" (change)="choose('phone')" />
            <mat-icon class="choice-icon" aria-hidden="true">smartphone</mat-icon>
            <span class="choice-text">
              <span class="choice-title">
                My phone
                <span class="choice-badge" *ngIf="recommended === 'phone'">Recommended</span>
              </span>
              <span class="choice-hint">Scan a QR code, then approve on your phone with Face ID or your fingerprint.</span>
            </span>
          </label>
        </fieldset>

        <div class="action-form">
          <div class="name-input-group">
            <label [for]="ids.name">{{ target() === 'phone' ? 'Phone name (optional)' : 'Device name' }}</label>
            <input type="text" class="device-name-input" [id]="ids.name" name="deviceName" [(ngModel)]="deviceName"
                   [placeholder]="target() === 'phone' ? 'e.g. My iPhone' : 'e.g. MacBook Pro'" autocomplete="off" maxlength="60"
                   [attr.aria-describedby]="ids.nameHint" />
            <span class="field-hint" [id]="ids.nameHint">{{ nameHint }}</span>
          </div>
          <button mat-flat-button type="submit" class="fintech-btn primary" [disabled]="loading() || !canContinue">
            <span *ngIf="!loading()">Continue</span>
            <mat-spinner *ngIf="loading()" diameter="20" color="accent" aria-label="Sending the code"></mat-spinner>
          </button>
        </div>
      </form>

      <!-- Step 2: OTP verification -->
      <div class="otp-section" *ngIf="step() === 'otp'">
        <div class="otp-banner" role="status">
          <mat-icon class="otp-icon" aria-hidden="true">mail_outline</mat-icon>
          <div class="otp-banner-text">
            <span class="otp-label">Verification code sent to <strong>{{ maskedEmail }}</strong></span>
            <span class="otp-code-display">Demo code: <strong>{{ otpCode }}</strong></span>
          </div>
        </div>
        <form class="action-form" (ngSubmit)="verifyAndRegister()">
          <div class="name-input-group">
            <label [for]="ids.otp">Verification code</label>
            <input type="text" class="device-name-input otp-input" [id]="ids.otp" name="otp" [(ngModel)]="otpInput"
                   (ngModelChange)="errorMessage.set('')"
                   placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code"
                   [attr.aria-invalid]="!!errorMessage()" [attr.aria-describedby]="ids.otpHint" />
            <span class="field-hint" [id]="ids.otpHint">{{ otpHint }}</span>
          </div>
          <button mat-flat-button type="submit" class="fintech-btn primary" [disabled]="loading() || !otpComplete">
            <span *ngIf="!loading()">{{ target() === 'phone' ? 'Show QR code' : 'Register' }}</span>
            <mat-spinner *ngIf="loading()" diameter="20" color="accent" aria-label="Registering the device"></mat-spinner>
          </button>
        </form>
        <div class="otp-links">
          <button mat-button type="button" class="link-btn" (click)="back()" [disabled]="loading()">
            <mat-icon aria-hidden="true">arrow_back</mat-icon> Back
          </button>
          <button mat-button type="button" class="link-btn" (click)="requestOtp(true)" [disabled]="loading()">
            <mat-icon aria-hidden="true">refresh</mat-icon> Send a new code
          </button>
        </div>
      </div>

      <!-- Step 3 (phone): QR code and live status -->
      <div class="pairing-section" *ngIf="step() === 'qr' && pairing() as session">
        <app-remote-session-panel [userId]="userId" [session]="session"
                                  instructions="Scan this QR code with the camera of your phone, then create the passkey on your phone."
                                  (completed)="onPaired()" (restart)="requestOtp(true)"></app-remote-session-panel>
        <div class="otp-links">
          <button mat-button type="button" class="link-btn" (click)="back()">
            <mat-icon aria-hidden="true">arrow_back</mat-icon> Back
          </button>
        </div>
      </div>

      <div class="error-message" *ngIf="errorMessage()" role="alert">
        <mat-icon aria-hidden="true">error_outline</mat-icon>
        <span>{{ errorMessage() }}</span>
      </div>
    </mat-card>
  `,
  styles: [`
    .action-card {
      padding: 20px 24px;
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
    }
    .action-header h3 {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 4px 0;
      color: var(--fintech-text);
    }
    .action-header p {
      font-size: 13px;
      line-height: 1.5;
      color: var(--fintech-text-secondary);
      margin: 0 0 16px 0;
    }
    .setup-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .choices {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 0;
      padding: 0;
      border: none;
      min-width: 0;
    }
    .choices-legend {
      grid-column: 1 / -1;
      padding: 0;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 500;
      color: var(--fintech-text-secondary);
    }
    .choice {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      border: 1px solid var(--fintech-border);
      border-radius: 12px;
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
    }
    .choice:hover:not(.disabled) { border-color: var(--fintech-text-secondary); }
    .choice.selected { border-color: var(--fintech-primary); box-shadow: inset 0 0 0 1px var(--fintech-primary); }
    .choice.disabled { cursor: not-allowed; opacity: 0.6; }
    .choice:focus-within { outline: 2px solid var(--fintech-info); outline-offset: 2px; }
    .choice input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
    }
    .choice-icon { color: var(--fintech-text); flex-shrink: 0; }
    .choice-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .choice-title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: var(--fintech-text);
    }
    .choice-badge {
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--fintech-success-bg);
      color: var(--fintech-success);
      font-size: 11px;
      font-weight: 600;
    }
    .choice-hint {
      font-size: 12px;
      line-height: 1.4;
      color: var(--fintech-text-secondary);
    }
    .action-form {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .action-form .fintech-btn {
      margin-top: 22px;
    }
    .name-input-group {
      flex: 1;
      min-width: 0;
    }
    .name-input-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--fintech-text-secondary);
      margin-bottom: 6px;
    }
    .field-hint {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      color: var(--fintech-text-secondary);
    }
    .device-name-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--fintech-border);
      border-radius: 10px;
      font-size: 14px;
      box-sizing: border-box;
      background: var(--fintech-surface);
      transition: border-color 0.2s;
      outline: none;
    }
    .device-name-input:focus {
      border-color: var(--fintech-primary);
    }
    .device-name-input[aria-invalid="true"] {
      border-color: var(--fintech-danger);
    }
    .otp-input {
      font-family: var(--fintech-font-mono);
      font-size: 20px;
      letter-spacing: 8px;
      text-align: center;
    }
    .otp-section, .pairing-section {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .otp-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--fintech-info-bg);
      border: 1px solid #bfdbfe;
      border-radius: 10px;
    }
    .otp-icon {
      color: var(--fintech-info);
      font-size: 28px;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }
    .otp-banner-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .otp-label {
      font-size: 13px;
      color: var(--fintech-text-secondary);
      word-break: break-word;
    }
    .otp-code-display {
      font-size: 18px;
      color: var(--fintech-info);
      font-family: var(--fintech-font-mono);
      letter-spacing: 2px;
    }
    .otp-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
    }
    .link-btn {
      color: var(--fintech-text-secondary) !important;
      font-size: 13px;
      padding: 4px 8px !important;
    }
    .error-message, .limit-notice {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.4;
    }
    .error-message {
      margin-top: 16px;
      background: var(--fintech-danger-bg);
      color: var(--fintech-danger);
    }
    .limit-notice {
      background: var(--fintech-info-bg);
      color: var(--fintech-text);
    }
    .limit-notice mat-icon { color: var(--fintech-info); }
    .error-message mat-icon, .limit-notice mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .fintech-btn {
      border-radius: 24px !important;
      padding: 8px 24px !important;
      font-weight: 600 !important;
      letter-spacing: 0 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }
    .fintech-btn.primary {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }
    .fintech-btn:disabled {
      background-color: var(--fintech-border) !important;
      color: var(--fintech-text-secondary) !important;
      cursor: not-allowed !important;
    }
    @media (max-width: 520px) {
      .choices { grid-template-columns: 1fr; }
      .action-form { flex-direction: column; align-items: stretch; }
      .action-form .fintech-btn { margin-top: 0; }
    }
  `]
})
export class DeviceRegistrationComponent implements OnInit {

  @Input() userId = '';
  /** The current trusted devices: once the account has as many as Adyen accepts, one must be removed first. */
  @Input() devices: Device[] = [];
  @Output() deviceRegistered = new EventEmitter<void>();

  private transferService = inject(TransferService);
  private remoteSessions = inject(RemoteSessionService);
  private snack = inject(MatSnackBar);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  private readonly uid = nextRegistrationId++;
  readonly ids = {
    target: `device-target-${this.uid}`,
    name: `device-name-${this.uid}`,
    nameHint: `device-name-hint-${this.uid}`,
    otp: `device-otp-${this.uid}`,
    otpHint: `device-otp-hint-${this.uid}`
  };

  private readonly thisKind = currentDeviceKind();
  readonly thisName = KIND_NAMES[this.thisKind];
  readonly thisIcon = KIND_ICONS[this.thisKind];
  /** A phone registers itself: pairing another phone with it would make no sense. */
  readonly canUsePhone = this.thisKind !== 'phone';
  readonly maxDevices = MAX_TRUSTED_DEVICES;

  loading = signal(false);
  step = signal<'name' | 'otp' | 'qr'>('name');
  target = signal<RegistrationTarget>('this');
  /** Whether this browser can create a passkey; null while it is checked. */
  passkeys = signal<boolean | null>(null);
  pairing = signal<RemoteSession | null>(null);
  errorMessage = signal('');
  deviceName = '';
  otpCode = '';
  maskedEmail = '';
  otpInput = '';
  private targetChosen = false;

  ngOnInit() {
    platformPasskeysAvailable().then(available => this.ngZone.run(() => {
      this.passkeys.set(available);
      if (!available && this.canUsePhone && !this.targetChosen) {
        this.target.set('phone');
      }
    }));
  }

  get recommended(): RegistrationTarget {
    return this.passkeys() === false ? 'phone' : 'this';
  }

  get atLimit(): boolean {
    return this.devices.length >= MAX_TRUSTED_DEVICES;
  }

  get canContinue(): boolean {
    return this.target() === 'phone' || !!this.deviceName.trim();
  }

  get nameHint(): string {
    if (this.target() === 'phone') return 'Leave it empty to name it after your phone, e.g. "My iPhone". We will email you a 6-digit verification code.';
    return this.deviceName.trim() ? 'We will email you a 6-digit verification code.' : 'Enter a device name to continue.';
  }

  get otpHint(): string {
    if (this.otpInput.length !== 6) return 'Enter the 6-digit code to continue.';
    return this.target() === 'phone'
      ? 'A QR code will then appear: scan it with your phone.'
      : 'Your browser will then ask you to create a passkey.';
  }

  get otpComplete(): boolean {
    return /^\d{6}$/.test(this.otpInput.trim());
  }

  choose(target: RegistrationTarget) {
    this.targetChosen = true;
    this.target.set(target);
    this.errorMessage.set('');
  }

  /** Back to the first step with an empty form. */
  reset() {
    this.step.set('name');
    this.pairing.set(null);
    this.errorMessage.set('');
    this.deviceName = '';
    this.clearOtp();
  }

  back() {
    this.step.set('name');
    this.pairing.set(null);
    this.errorMessage.set('');
    this.clearOtp();
  }

  async requestOtp(resend = false) {
    if (this.loading() || !this.canContinue) return;
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const res = await firstValueFrom(this.transferService.requestOtp(this.userId));
      this.ngZone.run(() => {
        this.otpCode = res.otp;
        this.maskedEmail = res.maskedEmail;
        this.otpInput = '';
        this.pairing.set(null);
        this.step.set('otp');
        if (resend) {
          this.snack.open('A new verification code has been sent.', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
        }
      });
    } catch (err) {
      this.ngZone.run(() => this.errorMessage.set(httpErrorMessage(err, "Couldn't send the verification code. Try again.")));
    } finally {
      this.ngZone.run(() => {
        this.loading.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  async verifyAndRegister() {
    if (this.loading() || !this.otpComplete) return;
    if (this.target() === 'phone') {
      await this.startPairing();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const scaWebauthn = ScaWebauthn.create({
        relyingPartyName: 'myplatform',
      });

      const sdkOutput = await scaWebauthn.checkAvailability();

      const initiateResponse = await firstValueFrom(
        this.transferService.initiateDeviceRegistration(String(sdkOutput), this.userId, this.deviceName.trim(), this.otpInput.trim())
      );

      if (!initiateResponse?.success) {
        throw new Error('INITIATE_FAILED');
      }

      const sdkOutputRegister = await withTimeout(
        scaWebauthn.register(initiateResponse.sdkInput),
        30000
      );

      const finalizeResponse = await firstValueFrom(
        this.transferService.finalizeRegistration(
          initiateResponse.id,
          String(sdkOutputRegister),
          this.userId,
          this.thisKind,
          currentPlatformLabel()
        )
      );

      if (!finalizeResponse?.success) {
        throw new Error('FINALIZE_FAILED');
      }

      await this.associateVirtualBankAccount(scaWebauthn, initiateResponse.id);

      // A phone chosen earlier in this browser would otherwise keep approving instead of this new passkey.
      saveApprovalMode(this.userId, 'here');
      this.ngZone.run(() => {
        this.reset();
        this.deviceRegistered.emit();
      });

    } catch (error: unknown) {
      this.ngZone.run(() => this.errorMessage.set(this.registrationErrorMessage(error)));
    } finally {
      this.ngZone.run(() => {
        this.loading.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  onPaired() {
    this.reset();
    this.deviceRegistered.emit();
  }

  /** The verification code is checked when the QR code is created: it can't be used again. */
  private async startPairing() {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const session = await firstValueFrom(
        this.remoteSessions.createPairing(this.userId, this.otpInput.trim(), this.deviceName.trim())
      );
      this.ngZone.run(() => {
        this.clearOtp();
        this.pairing.set(session);
        this.step.set('qr');
      });
    } catch (err) {
      this.ngZone.run(() => {
        if (httpStatus(err) === 403) {
          this.otpInput = '';
          this.errorMessage.set(INVALID_CODE_MESSAGE);
        } else {
          this.errorMessage.set(httpErrorMessage(err, "Couldn't prepare the QR code. Try again."));
        }
      });
    } finally {
      this.ngZone.run(() => {
        this.loading.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  private registrationErrorMessage(error: unknown): string {
    const code = (error as { message?: unknown } | null)?.message;
    if (httpStatus(error) === 403 || code === 'INITIATE_FAILED') {
      this.otpInput = '';
      return INVALID_CODE_MESSAGE;
    }
    if (code === 'FINALIZE_FAILED') {
      return "The passkey was created but the registration couldn't be completed. Try again.";
    }
    if (code === 'TIMEOUT') {
      return 'The passkey prompt timed out. Try again and answer the browser prompt within 30 seconds.';
    }
    if ((error as { code?: unknown } | null)?.code === 'SCA_UNAVAILABLE') {
      return this.canUsePhone
        ? 'Passkeys are not available in this browser. Choose "My phone" to register your phone instead.'
        : 'Passkeys are not available on this device or browser.';
    }
    return scaErrorMessage(error, "Couldn't register this device. Try again.");
  }

  private clearOtp() {
    this.otpCode = '';
    this.maskedEmail = '';
    this.otpInput = '';
  }

  private async associateVirtualBankAccount(scaWebauthn: ScaWebauthn, deviceId: string) {
    try {
      const assocResponse = await firstValueFrom(
        this.transferService.initiateDeviceAssociation(this.userId, deviceId)
      );

      if (!assocResponse?.associationRequired) {
        return;
      }

      const sdkOutputAssoc = await withTimeout(
        scaWebauthn.authenticate(assocResponse.sdkInput!),
        30000
      );

      await firstValueFrom(
        this.transferService.finalizeDeviceAssociation(
          this.userId, deviceId, String(sdkOutputAssoc), assocResponse.virtualPiId!
        )
      );
    } catch (error) {
      this.ngZone.run(() => {
        this.snack.open(
          scaErrorMessage(error, "The device is registered, but it couldn't be linked to your virtual bank account."),
          'Close',
          { duration: 6000, panelClass: 'fintech-snack-error' }
        );
      });
    }
  }
}
