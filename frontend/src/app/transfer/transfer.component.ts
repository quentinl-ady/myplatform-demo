import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from "@angular/common";
import { A11yModule } from '@angular/cdk/a11y';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { Observable, Subscription } from 'rxjs';
import { MaterialModule } from '../material.module';
import { DeviceRegistrationComponent } from '../device/device-registration.component';
import { AccountSetupStateComponent, LoadState, combineLoadStates, failedLoadState } from '../device/account-setup-state.component';
import { RemoteSessionPanelComponent } from '../remote-session/remote-session-panel.component';
import { ApprovalSwitchComponent } from '../remote-session/approval-switch.component';

import ScaWebauthn from '@adyen/bpscaweb';
import { AccountStatement, BankAccountInformationResponse, BankTransaction, RemoteSession, TransferDetail } from "../models";
import { AccountService, RemoteSessionService, TransferService } from "../services";
import {
  ApprovalChoice, ApprovalMode, MoneyPipe, approvalChoice, blobHttpErrorMessage, httpErrorMessage, saveApprovalMode,
  scaErrorMessage
} from '../shared';
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
    MatMenuModule,
    MoneyPipe,
    DeviceRegistrationComponent,
    AccountSetupStateComponent,
    RemoteSessionPanelComponent,
    ApprovalSwitchComponent
  ],
  templateUrl: './transfer.component.html',
  styleUrl: './transfer.component.css'
})
export class TransferComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private accountService = inject(AccountService);
  private transferService = inject(TransferService);
  private remoteSessions = inject(RemoteSessionService);
  private snack = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  userId = '';
  accountInfo?: BankAccountInformationResponse;
  isDownloadingRib = false;

  /** The latest account statements of the business account, listed in the Statements menu. */
  statements: AccountStatement[] = [];
  statementsState: 'loading' | 'ready' | 'error' = 'loading';
  /** File name of the statement being downloaded. */
  downloadingStatement: string | null = null;
  private statementsRequest?: Subscription;

  accountState: LoadState = 'loading';
  devicesState: LoadState = 'loading';
  hasDevices = false;
  /** With the passkey of this browser, or on a phone from a QR code. */
  approval: ApprovalChoice = { mode: 'here', canSwitch: false };
  loadErrorMessage = '';

  transactions: BankTransaction[] = [];
  isLoadingTransactions = false;
  transactionsError = '';
  /** Set while the transactions wait for the approval on the phone. */
  transactionsRemoteStart: (() => Observable<RemoteSession>) | null = null;

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
        this.loadStatements();
      }
    });
  }

  ngOnDestroy() {
    this.stopLastUpdatedTimer();
    this.statementsRequest?.unsubscribe();
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

  /** After a registration, a failed refresh still loads the transactions with what the page knows. */
  checkDevices(refresh = false) {
    if (!refresh) this.devicesState = 'loading';
    this.transferService.listDevices(this.userId).subscribe({
      next: async (devices) => {
        this.approval = await approvalChoice(devices, this.userId);
        this.hasDevices = !!devices && devices.length > 0;
        this.devicesState = 'ready';
        if (this.hasDevices) {
          this.loadTransactions();
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (refresh) {
          this.loadTransactions();
        } else {
          this.devicesState = failedLoadState(err);
          this.loadErrorMessage = httpErrorMessage(err, "Couldn't load your trusted devices. Try again.");
        }
        this.cdr.detectChanges();
      }
    });
  }

  onDeviceRegistered() {
    this.hasDevices = true;
    this.snack.open('Device registered. You can now view your transactions.', 'Close', { duration: 4000, panelClass: 'fintech-snack-success' });
    this.checkDevices(true);
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

    if (this.approval.mode === 'phone') {
      this.transactionsRemoteStart = () => this.remoteSessions.createApproval({ userId: this.userId, type: 'transactions' });
      this.cdr.detectChanges();
      return;
    }
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

  onTransactionsApprovedOnPhone(session: RemoteSession) {
    this.onTransactionsLoaded(session.result?.transactions);
  }

  /** Removing the QR code cancels its session. The choice also applies to the next visits in this browser. */
  switchApproval(mode: ApprovalMode) {
    this.approval = { ...this.approval, mode };
    saveApprovalMode(this.userId, mode);
    this.transactionsRemoteStart = null;
    this.isLoadingTransactions = false;
    this.loadTransactions(true);
  }

  private onTransactionsLoaded(transactions: BankTransaction[] | null | undefined) {
    this.transactionsRemoteStart = null;
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
        this.saveFile(blob, `RIB_${this.accountInfo?.bankAccountNumber || 'Account'}.pdf`);
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

  /** Also called each time the menu opens: Adyen adds statements while the page stays open. */
  loadStatements() {
    if (this.statementsState === 'error') {
      this.statementsState = 'loading';
    }
    this.statementsRequest?.unsubscribe();
    this.statementsRequest = this.accountService.getStatements(this.userId).subscribe({
      next: (statements) => {
        this.statements = statements;
        this.statementsState = 'ready';
        this.cdr.detectChanges();
      },
      error: () => {
        // A failed refresh keeps the statements already listed.
        if (this.statementsState !== 'ready') {
          this.statementsState = 'error';
        }
        this.cdr.detectChanges();
      }
    });
  }

  downloadStatement(statement: AccountStatement) {
    this.downloadingStatement = statement.fileName;
    this.cdr.detectChanges();
    this.accountService.downloadStatement(this.userId, statement.fileName).subscribe({
      next: (blob) => {
        this.saveFile(blob, statement.pdfFileName);
        this.downloadingStatement = null;
        this.cdr.detectChanges();
      },
      error: async (err) => {
        const message = await blobHttpErrorMessage(err, "Couldn't download the statement. Try again.");
        this.downloadingStatement = null;
        this.snack.open(message, 'Close', { duration: 5000, panelClass: 'fintech-snack-error' });
        this.cdr.detectChanges();
      }
    });
  }

  /** "19 Oct 2026" for a daily statement, "1 Oct 2026 – 31 Oct 2026" for a longer period. */
  statementPeriod(statement: AccountStatement): string {
    if (!statement.periodStart || !statement.periodEnd) {
      return formatDateTime(statement.creationDate);
    }
    const start = formatDate(statement.periodStart);
    return statement.periodStart === statement.periodEnd ? start : `${start} – ${formatDate(statement.periodEnd)}`;
  }

  trackStatement(_: number, statement: AccountStatement): string {
    return statement.fileName;
  }

  private saveFile(blob: Blob, fileName: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
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
