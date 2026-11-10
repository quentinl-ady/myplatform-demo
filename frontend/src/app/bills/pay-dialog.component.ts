import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';
import {
  Bill, BillPaymentItem, BillPaymentResult, BillSettings, BillTransferRoutes, PayeeCheck, TransferPriority
} from '../models';
import { BillService, SupplierService } from '../services';
import { InlineAlertComponent, MoneyPipe, formatMoney, httpErrorMessage } from '../shared';
import { TRANSFER_SPEEDS, TransferSpeed } from '../transfer-speed-picker/transfer-speeds';
import { payeeCheckView } from './bill-view';

export interface PayDialogData {
  userId: string;
  settings: BillSettings;
  bills: Bill[];
}

export interface PayDialogResult {
  /** At least one transfer was created. */
  payment: BillPaymentResult;
}

interface PayeeRow {
  bill: Bill;
  check: PayeeCheck | null;
  /** Null until the transfer speeds to its supplier are known. */
  routes: BillTransferRoutes | null;
}

interface SpeedChoice extends TransferSpeed {
  /** How many of the bills it can pay. */
  billCount: number;
}

/** Whether the routes to the supplier of a bill offer this speed for its amount. */
function canPay(routes: BillTransferRoutes | null, priority: TransferPriority): boolean {
  return !!routes && !routes.error && !!routes.speeds.find(speed => speed.priority === priority)?.available;
}

function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Checks the payees of the bills with Verification of Payee, and the transfer speeds Adyen offers to the bank of each
 * supplier, then creates one transfer per bill. The transfers wait for one approval, with SCA, on the Batch transfers
 * page.
 */
@Component({
  selector: 'app-pay-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MoneyPipe,
    InlineAlertComponent,
  ],
  templateUrl: './pay-dialog.component.html',
  styleUrls: [
    '../checkout/advanced-options/form-fields.css',
    '../invoices/dialog.css',
    '../transfer-speed-picker/transfer-speeds.css',
    './bill-dialogs.css',
  ],
})
export class PayDialogComponent implements OnInit {
  private readonly data: PayDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<PayDialogComponent, PayDialogResult>>(MatDialogRef);
  private readonly billService = inject(BillService);
  private readonly supplierService = inject(SupplierService);
  private readonly destroyRef = inject(DestroyRef);

  readonly bills = this.data.bills;
  readonly currency = this.data.settings.currency;
  readonly payeeCheckView = payeeCheckView;
  readonly title = this.bills.length === 1 ? `Pay ${this.bills[0].number} by transfer` : `Pay ${this.bills.length} bills by transfer`;

  readonly checks = signal<PayeeCheck[] | null>(null);
  readonly checking = signal(false);
  readonly checkError = signal<string | null>(null);
  /** The speeds that can pay each bill, from the routes Adyen offers to the bank of its supplier. */
  readonly routes = signal<BillTransferRoutes[] | null>(null);
  readonly loadingRoutes = signal(false);
  readonly routesError = signal<string | null>(null);
  /** The bills whose payee doesn't match, that the user chose to pay anyway. */
  readonly acceptedRisks = signal<ReadonlySet<number>>(new Set());
  readonly renamingSupplierId = signal<number | null>(null);
  readonly renameError = signal<string | null>(null);
  /** Null until the routes are known, and when no speed can pay any of the bills. */
  readonly transferType = signal<TransferPriority | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly failures = signal<BillPaymentItem[]>([]);

  readonly rows = computed<PayeeRow[]>(() => {
    const checks = this.checks() ?? [];
    const routes = this.routes() ?? [];
    return this.bills.map(bill => ({
      bill,
      check: checks.find(check => check.billId === bill.id) ?? null,
      routes: routes.find(route => route.billId === bill.id) ?? null,
    }));
  });
  readonly speedChoices = computed<SpeedChoice[]>(() => {
    const rows = this.rows();
    return TRANSFER_SPEEDS.map(speed => ({ ...speed, billCount: rows.filter(row => canPay(row.routes, speed.priority)).length }));
  });
  readonly included = computed(() => this.rows().filter(row => this.isIncluded(row)).map(row => row.bill));
  readonly includedTotal = computed(() => this.included().reduce((sum, bill) => sum + bill.total, 0));
  readonly canSubmit = computed(() => !this.submitting() && !this.checking() && !this.loadingRoutes() && !!this.routes()
    && !!this.transferType() && this.included().length > 0);

  private checkSub?: Subscription;
  private routesSub?: Subscription;

  ngOnInit(): void {
    this.runChecks();
    this.loadRoutes();
    this.destroyRef.onDestroy(() => {
      this.checkSub?.unsubscribe();
      this.routesSub?.unsubscribe();
    });
  }

  /**
   * A failed check, or a name that doesn't match unless the user accepts it, leaves the bill out; so does a speed the
   * route to its supplier doesn't offer.
   */
  isIncluded(row: PayeeRow): boolean {
    const result = row.check?.result;
    if (!row.check || result === 'error') return false;
    if (result === 'noNameMatch' && !this.acceptedRisks().has(row.bill.id)) return false;
    return !this.speedIssue(row);
  }

  /** Why the chosen speed can't pay the bill; null when it can, or while the routes to its supplier aren't known. */
  speedIssue(row: PayeeRow): string | null {
    const routes = row.routes;
    if (!routes) return null;
    if (routes.error) return asSentence(routes.error);
    const priority = this.transferType();
    if (!priority) return 'No transfer speed is available for this bill.';
    const speed = routes.speeds.find(option => option.priority === priority);
    if (speed?.available) return null;
    const label = TRANSFER_SPEEDS.find(option => option.priority === priority)?.label ?? priority;
    return asSentence(speed?.reason || `${label} transfers are not available for this beneficiary`);
  }

  runChecks(): void {
    this.checkSub?.unsubscribe();
    this.checking.set(true);
    this.checkError.set(null);
    this.checkSub = this.billService.checkPayees(this.data.userId, { billIds: this.bills.map(bill => bill.id) }).subscribe({
      next: checks => {
        this.checks.set(checks ?? []);
        this.checking.set(false);
      },
      error: err => {
        this.checkError.set(httpErrorMessage(err, 'Unable to verify the payees with their banks. Try again.'));
        this.checking.set(false);
      }
    });
  }

  loadRoutes(): void {
    this.routesSub?.unsubscribe();
    this.loadingRoutes.set(true);
    this.routesError.set(null);
    this.routesSub = this.billService.transferRoutes(this.data.userId, { billIds: this.bills.map(bill => bill.id) }).subscribe({
      next: routes => {
        this.routes.set(routes ?? []);
        this.loadingRoutes.set(false);
        this.transferType.set(this.defaultSpeed());
      },
      error: err => {
        this.routesError.set(httpErrorMessage(err, "The transfer speeds couldn't be checked. Try again."));
        this.loadingRoutes.set(false);
      }
    });
  }

  toggleRisk(bill: Bill, accepted: boolean): void {
    this.acceptedRisks.update(current => {
      const next = new Set(current);
      if (accepted) {
        next.add(bill.id);
      } else {
        next.delete(bill.id);
      }
      return next;
    });
  }

  /** The supplier takes the name its bank has, so the next check matches. */
  useVerifiedName(check: PayeeCheck): void {
    if (!check.name || this.renamingSupplierId() !== null) return;
    this.renamingSupplierId.set(check.supplierId);
    this.renameError.set(null);
    this.supplierService.useVerifiedName(this.data.userId, check.supplierId, check.name).subscribe({
      next: () => {
        this.renamingSupplierId.set(null);
        this.runChecks();
      },
      error: err => {
        this.renamingSupplierId.set(null);
        this.renameError.set(httpErrorMessage(err, "Unable to update the name of the supplier. Try again."));
      }
    });
  }

  submitLabel(): string {
    const count = this.included().length;
    if (!count) return 'Create transfers';
    const total = formatMoney(this.includedTotal(), this.currency);
    return count === 1 ? `Create the transfer of ${total}` : `Create ${count} transfers of ${total}`;
  }

  submit(): void {
    const bills = this.included();
    const transferType = this.transferType();
    if (!this.canSubmit() || !transferType) return;
    this.error.set(null);
    this.failures.set([]);
    this.submitting.set(true);
    this.dialogRef.disableClose = true;
    this.billService.payByTransfer(this.data.userId, {
      billIds: bills.map(bill => bill.id),
      transferType,
    }).subscribe({
      next: payment => {
        if (payment.created > 0) {
          this.dialogRef.close({ payment });
          return;
        }
        this.failures.set(payment.results.filter(item => !!item.error));
        this.error.set(payment.results.length === 1 ? "The transfer couldn't be created" : "None of the transfers could be created");
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
      },
      error: err => {
        this.failures.set([]);
        this.error.set(httpErrorMessage(err, 'Unable to create the transfers. Try again.'));
        this.submitting.set(false);
        this.dialogRef.disableClose = false;
      }
    });
  }

  trackRow(_: number, row: PayeeRow): number {
    return row.bill.id;
  }

  /** The cheapest speed that can pay the most bills. */
  private defaultSpeed(): TransferPriority | null {
    let best: SpeedChoice | null = null;
    for (const choice of this.speedChoices()) {
      if (choice.billCount > (best?.billCount ?? 0)) best = choice;
    }
    return best?.priority ?? null;
  }
}
