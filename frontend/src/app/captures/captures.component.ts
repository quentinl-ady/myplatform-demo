import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { MaterialModule } from '../material.module';
import { CheckoutPayment, CheckoutPaymentOperation, CheckoutPaymentState } from '../models';
import { CaptureService } from '../services';
import { ConfirmService, MoneyPipe, formatDateTime, formatMoney, formatTimeAgo, httpErrorMessage } from '../shared';
import { describeCaptureMode, describeSplitMode, splitLineLabel } from '../checkout/advanced-options/advanced-options';
import { CaptureDialogComponent, CaptureDialogData } from './capture-dialog.component';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type Filter = 'all' | 'open';

interface StateView {
  label: string;
  icon: string;
  tone: Tone;
}

const STATES: Record<CheckoutPaymentState, StateView> = {
  PENDING_AUTHORISATION: { label: 'Waiting for the result', icon: 'schedule', tone: 'warning' },
  AWAITING_CAPTURE: { label: 'To capture', icon: 'pending_actions', tone: 'info' },
  CAPTURE_SCHEDULED: { label: 'Capture scheduled', icon: 'event', tone: 'info' },
  CAPTURE_SUBMITTED: { label: 'Capture requested', icon: 'hourglass_top', tone: 'warning' },
  PARTIALLY_CAPTURED: { label: 'Partially captured', icon: 'timelapse', tone: 'info' },
  CAPTURED: { label: 'Captured', icon: 'check_circle', tone: 'success' },
  AUTO_CAPTURED: { label: 'Captured automatically', icon: 'check_circle', tone: 'success' },
  CANCEL_SUBMITTED: { label: 'Cancellation requested', icon: 'hourglass_top', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', icon: 'block', tone: 'neutral' },
  NOT_AUTHORISED: { label: 'Not authorised', icon: 'error_outline', tone: 'danger' },
};

/** States that only change with a webhook: the list refreshes on its own while a payment is in one of them. */
const WAITING_STATES = new Set<CheckoutPaymentState>(['PENDING_AUTHORISATION', 'CAPTURE_SUBMITTED', 'CANCEL_SUBMITTED']);
const POLL_INTERVAL_MS = 10000;

@Component({
  selector: 'app-captures',
  standalone: true,
  imports: [CommonModule, MaterialModule, RouterLink, MoneyPipe],
  templateUrl: './captures.component.html',
  styleUrl: './captures.component.css'
})
export class CapturesComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private captureService = inject(CaptureService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private confirmService = inject(ConfirmService);
  private liveAnnouncer = inject(LiveAnnouncer);
  private destroyRef = inject(DestroyRef);

  userId = '';
  readonly payments = signal<CheckoutPayment[]>([]);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly filter = signal<Filter>('all');
  readonly expandedId = signal<string | null>(null);
  readonly cancellingId = signal<string | null>(null);

  readonly openCount = computed(() => this.payments().filter(p => this.isOpen(p)).length);
  readonly visiblePayments = computed(() =>
    this.filter() === 'open' ? this.payments().filter(p => this.isOpen(p)) : this.payments());

  private fetchSub?: Subscription;

  ngOnInit(): void {
    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) this.load();
    });

    const poll = setInterval(() => this.refreshWhileWaiting(), POLL_INTERVAL_MS);
    this.destroyRef.onDestroy(() => {
      clearInterval(poll);
      this.fetchSub?.unsubscribe();
    });
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.fetch(true);
  }

  private refreshWhileWaiting(): void {
    if (document.hidden || this.loading() || this.refreshing() || !this.userId) return;
    if (this.payments().some(p => WAITING_STATES.has(p.state))) {
      this.fetch(false);
    }
  }

  /** A silent refresh keeps the current list when it fails. */
  private fetch(fullLoad: boolean): void {
    if (!fullLoad) this.refreshing.set(true);
    this.fetchSub?.unsubscribe();
    this.fetchSub = this.captureService.getPayments(this.userId).subscribe({
      next: payments => {
        this.notifyFailures(this.payments(), payments || []);
        this.payments.set(payments || []);
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: err => {
        if (fullLoad) this.loadError.set(httpErrorMessage(err, "Couldn't load the payments. Try again."));
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  /** A capture or cancellation refused in the webhook would otherwise only show in the history of the payment. */
  private notifyFailures(previous: CheckoutPayment[], current: CheckoutPayment[]): void {
    const waiting = new Set(previous.flatMap(p => p.operations.filter(op => op.status === 'RECEIVED').map(op => op.id)));
    const failed = current.flatMap(p => p.operations
      .filter(op => op.status === 'FAILED' && waiting.has(op.id))
      .map(op => ({ payment: p, operation: op })));
    if (!failed.length) return;
    const { payment, operation } = failed[0];
    const amount = operation.amount != null ? ` of ${formatMoney(operation.amount, payment.currency)}` : '';
    const action = operation.type === 'CANCEL' ? 'cancellation' : `capture${amount}`;
    const reason = operation.reason ? `: ${operation.reason}` : '';
    this.snackBar.open(`${payment.merchantReference}: the ${action} failed${reason}.`, 'Close', {
      duration: 8000, panelClass: 'fintech-snack-error'
    });
  }

  setFilter(filter: Filter): void {
    this.filter.set(filter);
  }

  toggle(payment: CheckoutPayment, event?: Event): void {
    event?.preventDefault();
    const selection = window.getSelection();
    if (event?.type === 'click' && selection && selection.toString().length > 0) return;
    this.expandedId.set(this.expandedId() === payment.id ? null : payment.id);
  }

  openCapture(payment: CheckoutPayment): void {
    const ref = this.dialog.open<CaptureDialogComponent, CaptureDialogData, CheckoutPayment>(CaptureDialogComponent, {
      data: { payment, userId: this.userId },
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: '#capture-amount',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(updated => {
      if (!updated) return;
      this.replace(updated);
      const message = 'Capture sent to Adyen. The status changes when the CAPTURE webhook arrives.';
      this.snackBar.open(message, 'Close', { duration: 6000, panelClass: 'fintech-snack-success' });
    });
  }

  async cancel(payment: CheckoutPayment): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Cancel this payment?',
      message: "Adyen releases the authorisation, so the shopper isn't charged. The payment can't be captured afterwards.",
      details: [
        { label: 'Reference', value: payment.merchantReference },
        { label: 'Amount', value: formatMoney(payment.amount, payment.currency) },
        ...(payment.pspReference ? [{ label: 'PSP reference', value: payment.pspReference }] : [])
      ],
      confirmText: 'Cancel payment',
      cancelText: 'Keep payment',
      danger: true
    });
    if (!confirmed) return;

    this.cancellingId.set(payment.id);
    this.captureService.cancel(payment.id, this.userId).subscribe({
      next: updated => {
        this.cancellingId.set(null);
        this.replace(updated);
        const message = 'Cancellation sent to Adyen. The status changes when the CANCELLATION webhook arrives.';
        this.snackBar.open(message, 'Close', { duration: 6000, panelClass: 'fintech-snack-success' });
      },
      error: err => {
        this.cancellingId.set(null);
        this.snackBar.open(httpErrorMessage(err, "Couldn't cancel the payment. Try again."), 'Close', {
          duration: 6000, panelClass: 'fintech-snack-error'
        });
        this.fetch(false);
      }
    });
  }

  private replace(updated: CheckoutPayment): void {
    this.payments.update(list => list.map(p => p.id === updated.id ? updated : p));
    this.liveAnnouncer.announce(`${updated.merchantReference}: ${this.stateOf(updated).label}`);
  }

  isOpen(payment: CheckoutPayment): boolean {
    return payment.canCapture || payment.canCancel || WAITING_STATES.has(payment.state);
  }

  stateOf(payment: CheckoutPayment): StateView {
    return STATES[payment.state] ?? { label: payment.state, icon: 'help_outline', tone: 'neutral' };
  }

  captureText(payment: CheckoutPayment): string {
    if (payment.state === 'CAPTURE_SCHEDULED' && payment.scheduledCaptureAt) {
      return `Automatic capture on ${formatDateTime(payment.scheduledCaptureAt)}`;
    }
    return describeCaptureMode(payment.captureMode, payment.captureDelayHours);
  }

  progressText(payment: CheckoutPayment): string {
    const { capturedAmount, pendingCaptureAmount, remainingAmount, releasedAmount, currency } = payment;
    if (capturedAmount > 0 || pendingCaptureAmount > 0) {
      const parts: string[] = [];
      if (capturedAmount > 0) parts.push(`${formatMoney(capturedAmount, currency)} captured`);
      if (pendingCaptureAmount > 0) parts.push(`${formatMoney(pendingCaptureAmount, currency)} requested`);
      if (remainingAmount > 0) parts.push(`${formatMoney(remainingAmount, currency)} left`);
      if (releasedAmount > 0) parts.push(`${formatMoney(releasedAmount, currency)} released`);
      return parts.join(', ');
    }
    return remainingAmount > 0 ? `${formatMoney(remainingAmount, currency)} to capture` : '';
  }

  summaryOf(payment: CheckoutPayment): string {
    return [this.captureText(payment), this.progressText(payment)].filter(Boolean).join(' · ');
  }

  splitText(payment: CheckoutPayment): string {
    return describeSplitMode(payment.splitMode, payment.splitSettings, payment.currency);
  }

  sourceLabel(payment: CheckoutPayment): string {
    const source = payment.source === 'issuing-checkout' ? 'Test issued cards' : 'Checkout';
    return `${source} · ${payment.channel === 'SAVED_CARD' ? 'Saved card' : 'Drop-in'}`;
  }

  splitLabel(type: string | null | undefined): string {
    return splitLineLabel(type);
  }

  operationTitle(operation: CheckoutPaymentOperation, payment: CheckoutPayment): string {
    if (operation.type === 'CANCEL') return 'Cancellation';
    const amount = operation.amount != null ? ` of ${formatMoney(operation.amount, payment.currency)}` : '';
    return operation.origin === 'ADYEN' ? `Capture${amount} made outside this page` : `Capture${amount}`;
  }

  operationStatus(operation: CheckoutPaymentOperation): string {
    const webhook = operation.type === 'CANCEL' ? 'CANCELLATION' : 'CAPTURE';
    switch (operation.status) {
      case 'SUCCEEDED':
        return 'Confirmed by Adyen';
      case 'FAILED':
        return operation.reason ? `Failed: ${operation.reason}` : 'Failed';
      default:
        return `Sent to Adyen, waiting for the ${webhook} webhook`;
    }
  }

  operationIcon(operation: CheckoutPaymentOperation): string {
    switch (operation.status) {
      case 'SUCCEEDED':
        return 'check_circle';
      case 'FAILED':
        return 'error_outline';
      default:
        return 'hourglass_top';
    }
  }

  dateTime(value: string | null | undefined): string {
    return formatDateTime(value);
  }

  timeAgo(value: string | null | undefined): string {
    return formatTimeAgo(value);
  }

  trackById(_: number, payment: CheckoutPayment): string {
    return payment.id;
  }

  trackOperation(_: number, operation: CheckoutPaymentOperation): number {
    return operation.id;
  }
}
