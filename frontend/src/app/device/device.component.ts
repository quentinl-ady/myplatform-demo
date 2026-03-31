import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ChangeDetectorRef } from '@angular/core';

import {
    AdyenPlatformExperience,
    DisputesOverview,
    PayoutsOverview,
    ReportsOverview
} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import { MyPlatformService, Device } from "../my-platform-service";
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
  selector: 'app-device',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule
  ],
  template: `
    <div class="fintech-wrapper">

      <div class="header-section">
        <h2>Trusted Devices</h2>
        <p>Manage the devices you use to securely approve transactions.</p>
      </div>

      <mat-card class="action-card">
        <div class="action-content">
          <div class="action-text">
            <h3>Add this device</h3>
            <p>Register the device you are currently using to enable SCA.</p>
          </div>
          <button mat-flat-button class="fintech-btn primary" (click)="registerDevice()" [disabled]="loading()">
            <span *ngIf="!loading()">Register</span>
            <mat-spinner *ngIf="loading()" diameter="20" color="accent"></mat-spinner>
          </button>
        </div>
      </mat-card>

      <div class="device-list" *ngIf="devices().length > 0">
        <h3 class="section-title">Your Devices</h3>

        <mat-card *ngFor="let d of devices()" class="device-card">
          <div class="device-info">
            <div class="device-icon">
              <mat-icon>devices</mat-icon>
            </div>
            <div class="device-details">
              <h4>{{ d.name || 'Unnamed Device' }}</h4>
              <span class="device-meta"><strong>Type:</strong> {{ d.type }}</span>
              <span class="device-meta"><strong>ID:</strong> {{ d.id }}</span>
              <span class="device-meta"><strong>Payment Instrument:</strong> {{ d.paymentInstrumentId }}</span>
            </div>
          </div>

          <div class="device-actions">
            <button mat-icon-button class="delete-btn" color="warn" (click)="deleteDevice(d)" [disabled]="deletingId() === d.id">
              <mat-icon *ngIf="deletingId() !== d.id">delete_outline</mat-icon>
              <mat-spinner *ngIf="deletingId() === d.id" diameter="20"></mat-spinner>
            </button>
          </div>
        </mat-card>
      </div>

      <mat-card class="empty-state" *ngIf="!devices().length && !loading()">
        <div class="empty-icon-wrapper">
          <mat-icon>phonelink_off</mat-icon>
        </div>
        <h3>No devices found</h3>
        <p>You haven't registered any devices yet. Register this one to get started.</p>
      </mat-card>

    </div>
  `,
  styles: [`
    :host {
      --fintech-primary: #000000;
      --fintech-bg: #f5f6f8;
      --fintech-surface: #ffffff;
      --fintech-text: #1a1a1a;
      --fintech-text-secondary: #737373;
      --fintech-border: #e5e5e5;
      --fintech-radius: 16px;
      --fintech-danger: #d32f2f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper {
      max-width: 540px;
      margin: 40px auto;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .header-section {
      text-align: left;
      margin-bottom: 8px;
    }
    .header-section h2 {
      font-size: 28px;
      font-weight: 700;
      color: var(--fintech-text);
      margin: 0 0 8px 0;
      letter-spacing: -0.5px;
    }
    .header-section p {
      color: var(--fintech-text-secondary);
      font-size: 15px;
      margin: 0;
    }

    mat-card {
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important;
      padding: 24px;
    }

    /* Action Card */
    .action-card {
      padding: 20px 24px;
    }
    .action-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .action-text h3 {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 4px 0;
      color: var(--fintech-text);
    }
    .action-text p {
      font-size: 13px;
      color: var(--fintech-text-secondary);
      margin: 0;
    }

    /* Buttons */
    .fintech-btn {
      border-radius: 24px !important;
      padding: 8px 24px !important;
      font-weight: 600 !important;
      letter-spacing: 0 !important;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .fintech-btn.primary {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }

    /* Device List */
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--fintech-text);
      margin: 32px 0 16px 0;
    }
    .device-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .device-card {
      display: flex;
      flex-direction: row !important;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
    }
    .device-info {
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .device-icon {
      width: 48px;
      height: 48px;
      background: var(--fintech-bg);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--fintech-text);
      flex-shrink: 0;
    }
    .device-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .device-details h4 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--fintech-text);
    }
    .device-meta {
      font-size: 12px;
      color: var(--fintech-text-secondary);
    }
    .delete-btn {
      color: var(--fintech-text-secondary) !important;
      transition: color 0.2s ease;
    }
    .delete-btn:hover {
      color: var(--fintech-danger) !important;
      background: rgba(211, 47, 47, 0.04);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 16px;
    }
    .empty-icon-wrapper {
      width: 64px;
      height: 64px;
      background: var(--fintech-bg);
      color: var(--fintech-text-secondary);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .empty-icon-wrapper mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
    .empty-state h3 {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--fintech-text);
    }
    .empty-state p {
      font-size: 14px;
      color: var(--fintech-text-secondary);
      margin: 0;
      max-width: 280px;
    }
  `]
})
export class DeviceComponent {

  private route = inject(ActivatedRoute);
  private authService = inject(MyPlatformService);
  private snack = inject(MatSnackBar);

  userId = '';

  devices = signal<Device[]>([]);
  loading = signal(false);
  deletingId = signal<string | null>(null);

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      this.loadDevices();
    });
  }

  loadDevices() {
    this.authService.listDevices(Number(this.userId)).subscribe({
      next: (res) => {
        this.devices.set(res ?? []);
      },
      error: () => {
        this.snack.open('Error loading devices', 'Close', { duration: 3000 });
      }
    });
  }

  async registerDevice() {

    if (this.loading()) return;

    this.loading.set(true);

    try {

      const scaWebauthn = ScaWebauthn.create({
        relyingPartyName: 'myplatform',
      });

      const sdkOutput = await scaWebauthn.checkAvailability();

      const initiateResponse = await firstValueFrom(
        this.authService.initiateDeviceRegistration(String(sdkOutput), Number(this.userId))
      );

      if (!initiateResponse?.success) {
        throw new Error('INITIATE_FAILED');
      }

      const sdkOutputRegister = await withTimeout(
        scaWebauthn.register(initiateResponse.sdkInput),
        30000
      );

      const finalizeResponse = await firstValueFrom(
        this.authService.finalizeRegistration(
          initiateResponse.id,
          String(sdkOutputRegister),
          Number(this.userId)
        )
      );

      if (!finalizeResponse?.success) {
        throw new Error('FINALIZE_FAILED');
      }

      this.snack.open('Device successfully registered ✅', 'OK', {
        duration: 3000
      });

      this.loadDevices();

    } catch (error: any) {

      let message = 'An error occurred';

      if (error?.name === 'NotAllowedError') {
        message = 'Authentication cancelled';
      } else if (error?.message === 'SCA_UNAVAILABLE') {
        message = 'SCA not available';
      } else if (error?.message === 'INITIATE_FAILED') {
        message = 'Initiation failed';
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

  async deleteDevice(device: Device) {

    if (this.deletingId()) return;

    this.deletingId.set(device.id);

    try {

      const response = await firstValueFrom(
        this.authService.deleteDevice({
          id: device.id,
          paymentInstrumentId: device.paymentInstrumentId
        })
      );

      if (response?.status !== 'success') {
        throw new Error('DELETE_FAILED');
      }

      this.snack.open('Device deleted successfully 🗑️', 'OK', {
        duration: 3000
      });

      this.loadDevices();

    } catch (error) {

      this.snack.open('Failed to delete device', 'Close', {
        duration: 4000
      });

    } finally {
      this.deletingId.set(null);
    }
  }
}
