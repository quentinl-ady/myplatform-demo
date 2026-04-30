import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from './device-registration.component';

import { Device } from "../models";
import { TransferService } from "../services";
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-device',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    DeviceRegistrationComponent
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

  onDeviceRegistered() {
    this.loadDevices();
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
