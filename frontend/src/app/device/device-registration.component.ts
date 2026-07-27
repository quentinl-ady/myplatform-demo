import { Component, inject, signal, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from "@angular/common";
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';

import { TransferService } from "../services";
import { firstValueFrom } from 'rxjs';
import ScaWebauthn from '@adyen/bpscaweb';

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
        <p>Register the device you are currently using to enable SCA.</p>
      </div>

      <!-- Step 1: Device name + Request OTP -->
      <div class="action-form" *ngIf="step === 'name'">
        <div class="name-input-group">
          <label>Device name</label>
          <input type="text" class="device-name-input" [(ngModel)]="deviceName" placeholder="e.g. MacBook Pro, iPhone 15..." />
        </div>
        <button mat-flat-button class="fintech-btn primary" (click)="requestOtp()" [disabled]="loading() || !deviceName.trim()">
          <span *ngIf="!loading()">Continue</span>
          <mat-spinner *ngIf="loading()" diameter="20" color="accent"></mat-spinner>
        </button>
      </div>

      <!-- Step 2: OTP verification -->
      <div class="otp-section" *ngIf="step === 'otp'">
        <div class="otp-banner">
          <mat-icon class="otp-icon">mail_outline</mat-icon>
          <div class="otp-banner-text">
            <span class="otp-label">Verification code sent to <strong>{{ maskedEmail }}</strong></span>
            <span class="otp-code-display">Code: <strong>{{ otpCode }}</strong></span>
          </div>
        </div>
        <div class="action-form">
          <div class="name-input-group">
            <label>Enter the 6-digit code</label>
            <input type="text" class="device-name-input otp-input" [(ngModel)]="otpInput"
                   placeholder="000000" maxlength="6" (keydown.enter)="verifyAndRegister()" />
          </div>
          <button mat-flat-button class="fintech-btn primary" (click)="verifyAndRegister()" [disabled]="loading() || otpInput.length !== 6">
            <span *ngIf="!loading()">Register</span>
            <mat-spinner *ngIf="loading()" diameter="20" color="accent"></mat-spinner>
          </button>
        </div>
        <button mat-button class="back-link" (click)="step = 'name'" [disabled]="loading()">
          <mat-icon>arrow_back</mat-icon> Back
        </button>
      </div>
    </mat-card>
  `,
  styles: [`
    .action-card {
      padding: 20px 24px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
    }
    .action-header h3 {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 4px 0;
      color: #1a1a1a;
    }
    .action-header p {
      font-size: 13px;
      color: #737373;
      margin: 0 0 16px 0;
    }
    .action-form {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    .name-input-group {
      flex: 1;
    }
    .name-input-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #737373;
      margin-bottom: 6px;
    }
    .device-name-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      font-size: 14px;
      box-sizing: border-box;
      background: #ffffff;
      transition: border-color 0.2s;
      outline: none;
    }
    .device-name-input:focus {
      border-color: #000000;
    }
    .otp-input {
      font-family: 'SF Mono', 'Fira Code', monospace;
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
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 10px;
    }
    .otp-icon {
      color: #0284c7;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    .otp-banner-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .otp-label {
      font-size: 13px;
      color: #475569;
    }
    .otp-code-display {
      font-size: 18px;
      color: #0284c7;
      font-family: 'SF Mono', 'Fira Code', monospace;
      letter-spacing: 2px;
    }
    .back-link {
      align-self: flex-start;
      color: #737373 !important;
      font-size: 13px;
      padding: 4px 8px !important;
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
      background-color: #000000 !important;
      color: white !important;
    }
    .fintech-btn:disabled {
      background-color: #e5e5e5 !important;
      color: #737373 !important;
      cursor: not-allowed !important;
    }
  `]
})
export class DeviceRegistrationComponent {

  @Input() userId = '';
  @Output() deviceRegistered = new EventEmitter<void>();

  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);

  loading = signal(false);
  deviceName = '';
  step: 'name' | 'otp' = 'name';
  otpCode = '';
  maskedEmail = '';
  otpInput = '';

  async requestOtp() {
    if (this.loading()) return;
    this.loading.set(true);

    try {
      const res = await firstValueFrom(this.transferService.requestOtp(this.userId));
      this.otpCode = res.otp;
      this.maskedEmail = res.maskedEmail;
      this.otpInput = '';
      this.step = 'otp';
    } catch {
      this.snack.open('Failed to send verification code', 'Close', { duration: 4000 });
    } finally {
      this.loading.set(false);
    }
  }

  async verifyAndRegister() {
    if (this.loading() || this.otpInput.length !== 6) return;

    this.loading.set(true);

    try {
      const scaWebauthn = ScaWebauthn.create({
        relyingPartyName: 'myplatform',
      });

      const sdkOutput = await scaWebauthn.checkAvailability();

      const initiateResponse = await firstValueFrom(
        this.transferService.initiateDeviceRegistration(String(sdkOutput), this.userId, this.deviceName.trim(), this.otpInput)
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

      this.deviceRegistered.emit();

    } catch (error: any) {
      let message = 'An error occurred';

      if (error?.status === 403) {
        message = 'Invalid or expired verification code';
        this.otpInput = '';
      } else if (error?.name === 'NotAllowedError') {
        message = 'Authentication cancelled';
      } else if (error?.message === 'SCA_UNAVAILABLE') {
        message = 'SCA not available';
      } else if (error?.message === 'INITIATE_FAILED') {
        message = 'Invalid or expired verification code';
        this.otpInput = '';
      } else if (error?.message === 'FINALIZE_FAILED') {
        message = 'Finalization failed';
      } else if (error?.message === 'TIMEOUT') {
        message = 'Request timed out';
      }

      this.snack.open(message, 'Close', { duration: 4000 });

    } finally {
      this.loading.set(false);
    }
  }

  private async associateVirtualBankAccount(scaWebauthn: any, deviceId: string) {
    try {
      const assocResponse = await firstValueFrom(
        this.transferService.initiateDeviceAssociation(this.userId, deviceId)
      );

      if (!assocResponse?.associationRequired) {
        return;
      }

      const sdkOutputAssoc = await withTimeout(
        scaWebauthn.authenticate(assocResponse.sdkInput),
        30000
      );

      await firstValueFrom(
        this.transferService.finalizeDeviceAssociation(
          this.userId, deviceId, String(sdkOutputAssoc), assocResponse.virtualPiId!
        )
      );
    } catch (error) {
      this.snack.open('Device registered but virtual bank account association failed', 'Close', { duration: 5000 });
    }
  }
}
