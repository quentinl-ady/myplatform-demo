import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';

import { Device } from "../models";
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
  selector: 'app-device',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule
  ],
  templateUrl: './device.component.html',
  styleUrl: './device.component.css'
})
export class DeviceComponent {

  private route = inject(ActivatedRoute);
  private transferService = inject(TransferService);
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
    this.transferService.listDevices(Number(this.userId)).subscribe({
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
        this.transferService.initiateDeviceRegistration(String(sdkOutput), Number(this.userId))
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
          Number(this.userId)
        )
      );

      if (!finalizeResponse?.success) {
        throw new Error('FINALIZE_FAILED');
      }

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
        this.transferService.deleteDevice({
          id: device.id,
          paymentInstrumentId: device.paymentInstrumentId
        })
      );

      if (response?.status !== 'success') {
        throw new Error('DELETE_FAILED');
      }

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
