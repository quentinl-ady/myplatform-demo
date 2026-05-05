import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, NgZone, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from "@angular/common";
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';

import ScaWebauthn from '@adyen/bpscaweb';
import { BankAccountInformationResponse, BankTransaction, TransferDetail } from "../models";
import { AccountService, TransferService } from "../services";

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    DeviceRegistrationComponent
  ],
  templateUrl: './transfer.component.html',
  styleUrl: './transfer.component.css'
})
export class TransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private snack = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  userId = '';
  accountInfo?: BankAccountInformationResponse;
  isDownloadingRib = false;

  hasDevices = signal<boolean | null>(null);

  transactions: BankTransaction[] = [];
  isLoadingTransactions = false;
  transactionsError = '';

  transferDetail?: TransferDetail;
  isLoadingDetail = false;
  detailError = '';

  lastUpdated: number | null = null;
  private lastUpdatedTimer: any = null;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.fetchAccountInformation();
        this.checkDevices();
      }
    });
  }

  fetchAccountInformation() {
    this.accountService.getBankAccountInformation(this.userId).subscribe({
      next: (info) => {
        this.accountInfo = info;
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to load account information', 'Close', { duration: 3000 });
      }
    });
  }

  checkDevices() {
    this.transferService.listDevices(this.userId).subscribe({
      next: (devices) => {
        this.hasDevices.set(devices && devices.length > 0);
        if (this.hasDevices()) {
          this.loadTransactions();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.hasDevices.set(false);
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices.set(true);
    this.snack.open('Device registered successfully! You can now view transactions.', 'Close', { duration: 4000 });
    this.loadTransactions();
    this.cdr.detectChanges();
  }

  async loadTransactions(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = this.transferService.getCachedTransactions(this.userId);
      if (cached) {
        this.transactions = cached;
        this.lastUpdated = this.transferService.getCacheTimestamp(this.userId);
        this.isLoadingTransactions = false;
        this.startLastUpdatedTimer();
        this.cdr.detectChanges();
        return;
      }
    } else {
      this.transferService.invalidateTransactionCache(this.userId);
    }

    this.isLoadingTransactions = true;
    this.transactionsError = '';
    this.cdr.detectChanges();

    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.checkAvailability();

      this.transferService.initiateBankTransactions(this.userId, String(sdkOutput)).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            if (res.status === 'completed') {
              this.transactions = res.transactions || [];
              this.transferService.setCachedTransactions(this.userId, this.transactions);
              this.lastUpdated = Date.now();
              this.startLastUpdatedTimer();
              this.isLoadingTransactions = false;
            } else if (res.status === 'sca_required') {
              this.handleScaChallenge(res.authParam1, res.createdSince, res.createdUntil);
            } else {
              this.isLoadingTransactions = false;
              this.transactionsError = 'Unexpected response';
            }
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isLoadingTransactions = false;
            this.transactionsError = err.error?.message || 'Failed to load transactions';
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isLoadingTransactions = false;
      this.transactionsError = 'SCA initialization failed';
      this.cdr.detectChanges();
    }
  }

  private async handleScaChallenge(authParam1: string, createdSince: string, createdUntil: string) {
    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.authenticate(authParam1);

      this.transferService.finalizeBankTransactions(this.userId, String(sdkOutput), createdSince, createdUntil).subscribe({
        next: (res) => {
          this.ngZone.run(() => {
            this.transactions = res.transactions || [];
            this.transferService.setCachedTransactions(this.userId, this.transactions);
            this.lastUpdated = Date.now();
            this.startLastUpdatedTimer();
            this.isLoadingTransactions = false;
            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          this.ngZone.run(() => {
            this.isLoadingTransactions = false;
            this.transactionsError = err.error?.message || 'Failed to finalize transactions';
            this.cdr.detectChanges();
          });
        }
      });
    } catch (e) {
      this.isLoadingTransactions = false;
      this.transactionsError = 'SCA authentication failed';
      this.cdr.detectChanges();
    }
  }

  refresh() {
    this.loadTransactions(true);
  }

  openDetail(tx: BankTransaction) {
    if (!tx.transferId) {
      this.snack.open('No transfer detail available for this transaction', 'Close', { duration: 3000 });
      return;
    }
    this.transferDetail = undefined;
    this.detailError = '';
    this.isLoadingDetail = true;
    this.cdr.detectChanges();

    this.transferService.getTransferDetail(this.userId, tx.transferId).subscribe({
      next: (detail) => {
        this.transferDetail = detail;
        this.isLoadingDetail = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoadingDetail = false;
        this.detailError = err.error?.message || 'Failed to load transfer detail';
        this.cdr.detectChanges();
      }
    });
  }

  closeDetail() {
    this.transferDetail = undefined;
    this.detailError = '';
    this.isLoadingDetail = false;
    this.cdr.detectChanges();
  }

  downloadRib() {
    this.isDownloadingRib = true;
    this.accountService.getRibPdf(this.userId).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RIB_${this.accountInfo?.bankAccountNumber || 'Account'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.isDownloadingRib = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isDownloadingRib = false;
        this.snack.open('Failed to download RIB', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  formatAmount(minorUnits: number): string {
    const abs = Math.abs(minorUnits);
    return (abs / 100).toFixed(2);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return dateStr;
    }
  }

  isIncoming(tx: BankTransaction): boolean {
    return tx.amount > 0;
  }

  isDetailOpen(): boolean {
    return this.isLoadingDetail || !!this.transferDetail || !!this.detailError;
  }

  getCounterpartyAccount(d: TransferDetail): string {
    if (d.counterpartyIban) return d.counterpartyIban;
    if (d.counterpartyAccountNumber) return d.counterpartyAccountNumber;
    return '-';
  }

  getDirectionLabel(direction: string): string {
    return direction === 'incoming' ? 'Incoming' : 'Outgoing';
  }

  getLastUpdatedLabel(): string {
    if (!this.lastUpdated) return '';
    const seconds = Math.floor((Date.now() - this.lastUpdated) / 1000);
    if (seconds < 60) return 'Updated just now';
    const minutes = Math.floor(seconds / 60);
    return `Updated ${minutes} min ago`;
  }

  private startLastUpdatedTimer() {
    this.stopLastUpdatedTimer();
    this.lastUpdatedTimer = setInterval(() => {
      if (this.lastUpdated) {
        this.cdr.detectChanges();
      }
    }, 30_000);
  }

  private stopLastUpdatedTimer() {
    if (this.lastUpdatedTimer) {
      clearInterval(this.lastUpdatedTimer);
      this.lastUpdatedTimer = null;
    }
  }

  ngOnDestroy() {
    this.stopLastUpdatedTimer();
  }
}
