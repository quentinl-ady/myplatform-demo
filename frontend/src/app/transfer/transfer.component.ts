import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from "@angular/common";
import { A11yModule } from '@angular/cdk/a11y';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';
import { AccountSetupStateComponent, LoadState, combineLoadStates, failedLoadState } from '../device/account-setup-state.component';

import ScaWebauthn from '@adyen/bpscaweb';
import { BankAccountInformationResponse, BankTransaction, TransferDetail } from "../models";
import { AccountService, TransferService } from "../services";
import { MoneyPipe, httpErrorMessage, scaErrorMessage } from '../shared';
import { formatDate, formatDateTime, speedLabel } from '../banktransfer/format-date';
import { bankDetailRows, DetailRow } from '../banktransfer/bank-details';

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    A11yModule,
    MaterialModule,
    MoneyPipe,
    DeviceRegistrationComponent,
    AccountSetupStateComponent
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

  accountState: LoadState = 'loading';
  devicesState: LoadState = 'loading';
  hasDevices = false;
  loadErrorMessage = '';

  transactions: BankTransaction[] = [];
  isLoadingTransactions = false;
  transactionsError = '';

  transferDetail?: TransferDetail;
  isLoadingDetail = false;
  detailError = '';

  lastUpdated: number | null = null;
  private lastUpdatedTimer: ReturnType<typeof setInterval> | null = null;

  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly speedLabel = speedLabel;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.fetchAccountInformation();
        this.checkDevices();
      }
    });
  }

  ngOnDestroy() {
    this.stopLastUpdatedTimer();
  }

  get setupState(): LoadState {
    return combineLoadStates(this.accountState, this.devicesState);
  }

  retryPage() {
    if (this.accountState !== 'ready') this.fetchAccountInformation();
    if (this.devicesState !== 'ready') this.checkDevices();
  }

  fetchAccountInformation() {
    this.accountState = 'loading';
    this.accountService.getBankAccountInformation(this.userId).subscribe({
      next: (info) => {
        this.accountInfo = info;
        this.accountState = 'ready';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.accountState = failedLoadState(err);
        this.loadErrorMessage = httpErrorMessage(err, "Couldn't load your account. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  checkDevices() {
    this.devicesState = 'loading';
    this.transferService.listDevices(this.userId).subscribe({
      next: (devices) => {
        this.hasDevices = !!devices && devices.length > 0;
        this.devicesState = 'ready';
        if (this.hasDevices) {
          this.loadTransactions();
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.devicesState = failedLoadState(err);
        this.loadErrorMessage = httpErrorMessage(err, "Couldn't load your trusted devices. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices = true;
    this.snack.open('Device registered. You can now view your transactions.', 'Close', { duration: 4000, panelClass: 'fintech-snack-success' });
    this.loadTransactions();
    this.cdr.detectChanges();
  }

  async loadTransactions(forceRefresh = false) {
    if (this.isLoadingTransactions) return;
    if (!forceRefresh) {
      const cached = this.transferService.getCachedTransactions(this.userId);
      if (cached) {
        this.transactions = cached;
        this.lastUpdated = this.transferService.getCacheTimestamp(this.userId);
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
              this.onTransactionsLoaded(res.transactions);
            } else if (res.status === 'sca_required') {
              this.handleScaChallenge(res.authParam1, res.createdSince, res.createdUntil);
            } else {
              this.failTransactions("Couldn't load your transactions: unexpected response. Try again.");
            }
          });
        },
        error: (err) => {
          this.ngZone.run(() => this.failTransactions(httpErrorMessage(err, "Couldn't load your transactions. Try again.")));
        }
      });
    } catch (e) {
      this.ngZone.run(() => this.failTransactions(scaErrorMessage(e, "Couldn't start the authentication. Try again.")));
    }
  }

  private async handleScaChallenge(authParam1: string, createdSince: string, createdUntil: string) {
    try {
      const scaWebauthn = ScaWebauthn.create({ relyingPartyName: 'myplatform' });
      const sdkOutput = await scaWebauthn.authenticate(authParam1);

      this.transferService.finalizeBankTransactions(this.userId, String(sdkOutput), createdSince, createdUntil).subscribe({
        next: (res) => {
          this.ngZone.run(() => this.onTransactionsLoaded(res.transactions));
        },
        error: (err) => {
          this.ngZone.run(() => this.failTransactions(httpErrorMessage(err, "Couldn't load your transactions. Try again.")));
        }
      });
    } catch (e) {
      this.ngZone.run(() => this.failTransactions(scaErrorMessage(e, 'Authentication failed. Try again.')));
    }
  }

  private onTransactionsLoaded(transactions: BankTransaction[] | null | undefined) {
    this.transactions = transactions || [];
    this.transferService.setCachedTransactions(this.userId, this.transactions);
    this.lastUpdated = Date.now();
    this.startLastUpdatedTimer();
    this.isLoadingTransactions = false;
    this.transactionsError = '';
    this.cdr.detectChanges();
  }

  private failTransactions(message: string) {
    this.isLoadingTransactions = false;
    this.transactionsError = message;
    this.cdr.detectChanges();
  }

  refresh() {
    this.loadTransactions(true);
  }

  openDetail(tx: BankTransaction) {
    if (!tx.transferId) {
      this.snack.open('No transfer details are available for this transaction.', 'Close', { duration: 3000 });
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
        this.detailError = httpErrorMessage(err, "Couldn't load the transfer details. Try again.");
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
      error: (err) => {
        this.isDownloadingRib = false;
        this.snack.open(httpErrorMessage(err, "Couldn't download your bank details (RIB). Try again."), 'Close', { duration: 5000, panelClass: 'fintech-snack-error' });
        this.cdr.detectChanges();
      }
    });
  }

  isIncoming(tx: BankTransaction): boolean {
    return tx.amount > 0;
  }

  /** The detail amount is unsigned: its sign comes from the direction. */
  detailSignedAmount(d: TransferDetail): number {
    if (d.direction === 'outgoing' && d.amount > 0) return -d.amount;
    if (d.direction === 'incoming' && d.amount < 0) return -d.amount;
    return d.amount;
  }

  isDetailOpen(): boolean {
    return this.isLoadingDetail || !!this.transferDetail || !!this.detailError;
  }

  counterpartyRows(d: TransferDetail): DetailRow[] {
    return bankDetailRows({
      iban: d.counterpartyIban,
      accountNumber: d.counterpartyAccountNumber,
      sortCode: d.counterpartySortCode,
      routingNumber: d.counterpartyRoutingNumber
    });
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
    // Outside the zone: refreshing the label must not trigger a full change detection every 30 seconds.
    this.ngZone.runOutsideAngular(() => {
      this.lastUpdatedTimer = setInterval(() => {
        if (this.lastUpdated) {
          this.cdr.detectChanges();
        }
      }, 30_000);
    });
  }

  private stopLastUpdatedTimer() {
    if (this.lastUpdatedTimer) {
      clearInterval(this.lastUpdatedTimer);
      this.lastUpdatedTimer = null;
    }
  }
}
