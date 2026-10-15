import { ChangeDetectorRef, Component, EventEmitter, Input, NgZone, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';

import { TransferService } from '../services';
import { httpErrorMessage, httpStatus, scaErrorMessage } from '../shared';
import { firstValueFrom } from 'rxjs';
import ScaWebauthn from '@adyen/bpscaweb';

const INVALID_CODE_MESSAGE = 'This verification code is invalid or has expired. Check the code or send a new one.';

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
    MaterialModule
  ],
  template: `
    <mat-card class="action-card">
      <div class="action-header">
        <h3>Add this device</h3>
        <p>Register the device you are using now. You will approve transfers with its passkey (Touch ID, Face ID, Windows Hello or a security key).</p>
      </div>

      <!-- Step 1: Device name + Request OTP -->
      <form class="action-form" *ngIf="step() === 'name'" (ngSubmit)="requestOtp()">
        <div class="name-input-group">
          <label [for]="ids.name">Device name</label>
          <input type="text" class="device-name-input" [id]="ids.name" name="deviceName" [(ngModel)]="deviceName"
                 placeholder="e.g. MacBook Pro, iPhone 15" autocomplete="off" maxlength="60"
                 [attr.aria-describedby]="ids.nameHint" />
          <span class="field-hint" [id]="ids.nameHint">
            {{ deviceName.trim() ? 'We will email you a 6-digit verification code.' : 'Enter a device name to continue.' }}
          </span>
        </div>
        <button mat-flat-button type="submit" class="fintech-btn primary" [disabled]="loading() || !deviceName.trim()">
          <span *ngIf="!loading()">Continue</span>
          <mat-spinner *ngIf="loading()" diameter="20" color="accent" aria-label="Sending the code"></mat-spinner>
        </button>
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
            <span class="field-hint" [id]="ids.otpHint">
              {{ otpInput.length === 6 ? 'Your browser will then ask you to create a passkey.' : 'Enter the 6-digit code to continue.' }}
            </span>
          </div>
          <button mat-flat-button type="submit" class="fintech-btn primary" [disabled]="loading() || !otpComplete">
            <span *ngIf="!loading()">Register</span>
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
    .otp-section {
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
    .error-message {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 16px;
      padding: 10px 14px;
      border-radius: 10px;
      background: var(--fintech-danger-bg);
      color: var(--fintech-danger);
      font-size: 13px;
      line-height: 1.4;
    }
    .error-message mat-icon {
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
      .action-form { flex-direction: column; align-items: stretch; }
      .action-form .fintech-btn { margin-top: 0; }
    }
  `]
})
export class DeviceRegistrationComponent {

  @Input() userId = '';
  @Output() deviceRegistered = new EventEmitter<void>();

  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  private readonly uid = nextRegistrationId++;
  readonly ids = {
    name: `device-name-${this.uid}`,
    nameHint: `device-name-hint-${this.uid}`,
    otp: `device-otp-${this.uid}`,
    otpHint: `device-otp-hint-${this.uid}`
  };

  loading = signal(false);
  step = signal<'name' | 'otp'>('name');
  errorMessage = signal('');
  deviceName = '';
  otpCode = '';
  maskedEmail = '';
  otpInput = '';

  get otpComplete(): boolean {
    return /^\d{6}$/.test(this.otpInput.trim());
  }

  /** Back to the first step with an empty form. */
  reset() {
    this.step.set('name');
    this.errorMessage.set('');
    this.deviceName = '';
    this.clearOtp();
  }

  back() {
    this.step.set('name');
    this.errorMessage.set('');
    this.clearOtp();
  }

  async requestOtp(resend = false) {
    if (this.loading() || !this.deviceName.trim()) return;
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const res = await firstValueFrom(this.transferService.requestOtp(this.userId));
      this.ngZone.run(() => {
        this.otpCode = res.otp;
        this.maskedEmail = res.maskedEmail;
        this.otpInput = '';
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
          this.userId
        )
      );

      if (!finalizeResponse?.success) {
        throw new Error('FINALIZE_FAILED');
      }

      await this.associateVirtualBankAccount(scaWebauthn, initiateResponse.id);

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
    if (code === 'SCA_UNAVAILABLE') {
      return 'Passkeys are not available on this device or browser.';
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
