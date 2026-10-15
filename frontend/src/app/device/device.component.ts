import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from './device-registration.component';
import { AccountSetupStateComponent, LoadState, failedLoadState } from './account-setup-state.component';

import { Device } from "../models";
import { TransferService } from "../services";
import { ConfirmService, httpErrorMessage } from '../shared';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-device',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    DeviceRegistrationComponent,
    AccountSetupStateComponent
  ],
  templateUrl: './device.component.html',
  styleUrl: './device.component.css'
})
export class DeviceComponent implements OnInit {

  private route = inject(ActivatedRoute);
  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);
  private confirmService = inject(ConfirmService);

  userId = '';

  devices = signal<Device[]>([]);
  state = signal<LoadState>('loading');
  errorMessage = signal('');
  deletingId = signal<string | null>(null);

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      this.loadDevices();
    });
  }

  loadDevices(showSpinner = true) {
    if (showSpinner) this.state.set('loading');
    this.transferService.listDevices(this.userId).subscribe({
      next: (res) => {
        this.devices.set(res ?? []);
        this.state.set('ready');
      },
      error: (err) => {
        const state = failedLoadState(err);
        if (!showSpinner && state === 'error') {
          this.toastError(httpErrorMessage(err, "Couldn't refresh your devices. Try again."));
          return;
        }
        this.errorMessage.set(httpErrorMessage(err, "Couldn't load your devices. Try again."));
        this.state.set(state);
      }
    });
  }

  onDeviceRegistered() {
    this.snack.open('Device registered. You can now approve transfers with it.', 'Close', { duration: 4000, panelClass: 'fintech-snack-success' });
    this.loadDevices(false);
  }

  async deleteDevice(device: Device) {
    if (this.deletingId()) return;

    const confirmed = await this.confirmService.confirm({
      title: 'Remove this trusted device?',
      message: 'You will no longer be able to approve transfers with this device. You can register it again later.',
      details: [
        { label: 'Device', value: device.name || 'Unnamed device' },
        { label: 'Type', value: device.type || '—' }
      ],
      confirmText: 'Remove device',
      danger: true
    });
    if (!confirmed) return;

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

      this.devices.set(this.devices().filter(d => d.id !== device.id));
      this.snack.open('Device removed', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
      this.loadDevices(false);
    } catch (error) {
      this.toastError(httpErrorMessage(error, "Couldn't remove this device. Try again."));
    } finally {
      this.deletingId.set(null);
    }
  }

  private toastError(message: string) {
    this.snack.open(message, 'Close', { duration: 5000, panelClass: 'fintech-snack-error' });
  }
}
