import {
  ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges,
  computed, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EMPTY, Observable, Subscription, catchError, exhaustMap, timer } from 'rxjs';
import { RemoteSession } from '../models';
import { RemoteSessionService } from '../services';
import { httpErrorMessage, httpStatus, remoteLink, remoteLinkProblem } from '../shared';
// Not in the shared barrel: the QR code library would end up in the initial bundle.
import { qrCode } from '../shared/qr';

const POLL_MS = 2000;

/** Whether the phone can still act on the session. */
export function isRemoteSessionActive(session: RemoteSession | null | undefined): boolean {
  return !!session && (session.status === 'waiting' || session.status === 'opened' || session.status === 'in_progress');
}

/**
 * QR code of a registration or an approval to finish on the phone, and its live status. The
 * session is cancelled when the panel goes away before the phone completed it.
 */
@Component({
  selector: 'app-remote-session-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="remote-panel">

      <div class="remote-state" *ngIf="creating()" role="status">
        <mat-spinner diameter="28" aria-hidden="true"></mat-spinner>
        <p class="state-text">Preparing the QR code...</p>
      </div>

      <ng-container *ngIf="!creating() && createError()">
        <div class="remote-alert error" role="alert">
          <mat-icon aria-hidden="true">error_outline</mat-icon>
          <span>{{ createError() }}</span>
        </div>
        <button type="button" class="remote-btn" (click)="again()">Try again</button>
      </ng-container>

      <ng-container *ngIf="!creating() && current() as s">

        <ng-container *ngIf="s.status === 'waiting' || (qrAgain() && isActive(s))">
          <div class="remote-alert" *ngIf="linkProblem" role="note">
            <mat-icon aria-hidden="true">info_outline</mat-icon>
            <span>{{ linkProblem }}</span>
          </div>
          <div class="qr-block">
            <svg *ngIf="qr() as code" class="qr" [attr.viewBox]="'0 0 ' + code.size + ' ' + code.size"
                 role="img" aria-label="QR code to scan with your phone" shape-rendering="crispEdges">
              <rect [attr.width]="code.size" [attr.height]="code.size" fill="#fff"></rect>
              <path [attr.d]="code.path" fill="#000"></path>
            </svg>
            <p class="qr-text">{{ instructions }}</p>
            <button type="button" class="link-btn" *ngIf="canCopy" (click)="copyLink()">
              <mat-icon aria-hidden="true">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
              {{ copied() ? 'Link copied' : "Can't scan? Copy the link" }}
            </button>
          </div>
        </ng-container>

        <div class="remote-state" *ngIf="s.status === 'opened' || s.status === 'in_progress'" role="status">
          <div class="state-icon" aria-hidden="true"><mat-icon>smartphone</mat-icon></div>
          <p class="state-title">{{ s.status === 'in_progress' ? 'Confirm on your phone' : 'Continue on your phone' }}</p>
          <p class="state-text">
            {{ s.status === 'in_progress'
              ? 'Use Face ID, your fingerprint or your screen lock when your phone asks.'
              : 'Opened on ' + (s.phoneLabel || 'your phone') + '. Check the details there, then confirm.' }}
          </p>
          <mat-spinner diameter="22" aria-hidden="true"></mat-spinner>
          <button type="button" class="link-btn" *ngIf="!qrAgain()" (click)="qrAgain.set(true)">Show the QR code again</button>
        </div>

        <div class="remote-alert" *ngIf="isActive(s) && s.phonePasskeys === false" role="alert">
          <mat-icon aria-hidden="true">warning_amber</mat-icon>
          <span>The browser of your phone can't use passkeys. Open the link in Safari on iPhone or Chrome on Android, with Face ID, a fingerprint or a screen lock set up.</span>
        </div>
        <div class="remote-alert" *ngIf="isActive(s) && s.message" role="alert">
          <mat-icon aria-hidden="true">warning_amber</mat-icon>
          <span>On your phone: {{ s.message }} You can try again there.</span>
        </div>

        <p class="countdown" *ngIf="isActive(s)">Expires in {{ countdown() }}</p>

        <div class="remote-state" *ngIf="s.status === 'completed'" role="status">
          <div class="state-icon done" aria-hidden="true"><mat-icon>check</mat-icon></div>
          <p class="state-title">Confirmed on your phone</p>
        </div>

        <div class="remote-state" *ngIf="!isActive(s) && s.status !== 'completed'" role="alert">
          <div class="state-icon" aria-hidden="true"><mat-icon>{{ s.status === 'declined' ? 'block' : 'timer_off' }}</mat-icon></div>
          <p class="state-title">{{ endTitle(s) }}</p>
          <p class="state-text">{{ endText(s) }}</p>
          <button type="button" class="remote-btn" (click)="again()">Show a new QR code</button>
        </div>

      </ng-container>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .remote-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      text-align: center;
    }
    .qr-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .qr {
      width: 184px;
      height: 184px;
      padding: 6px;
      border: 1px solid var(--fintech-border);
      border-radius: 12px;
      background: #fff;
    }
    .qr-text, .state-text {
      margin: 0;
      max-width: 340px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--fintech-text-secondary);
    }
    .remote-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
    }
    .state-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--fintech-bg);
      color: var(--fintech-text);
    }
    .state-icon.done { background: var(--fintech-success-bg); color: var(--fintech-success); }
    .state-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--fintech-text);
    }
    .countdown {
      margin: 0;
      font-size: 12px;
      color: var(--fintech-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .remote-alert {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--fintech-warning-bg);
      color: var(--fintech-text);
      font-size: 13px;
      line-height: 1.4;
      text-align: left;
    }
    .remote-alert mat-icon { color: var(--fintech-warning); font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .remote-alert.error { background: var(--fintech-danger-bg); color: var(--fintech-danger); }
    .remote-alert.error mat-icon { color: var(--fintech-danger); }
    .remote-btn {
      border: none;
      border-radius: 24px;
      padding: 8px 20px;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      background: var(--fintech-primary);
      color: #fff;
    }
    .link-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: none;
      padding: 4px 8px;
      font: inherit;
      font-size: 13px;
      color: var(--fintech-text-secondary);
      cursor: pointer;
      border-radius: 8px;
    }
    .link-btn:hover { color: var(--fintech-text); background: var(--fintech-bg); }
    .link-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `]
})
export class RemoteSessionPanelComponent implements OnInit, OnChanges, OnDestroy {

  @Input({ required: true }) userId = '';
  /** A session already created, with its token. */
  @Input() session: RemoteSession | null = null;
  /** Creates the session when none is given, and a new one when the user asks for a new QR code. */
  @Input() start: (() => Observable<RemoteSession>) | null = null;
  @Input() instructions = 'Scan this QR code with the camera of your phone, then follow the steps on your phone.';
  @Output() completed = new EventEmitter<RemoteSession>();
  /** The user asks for a new QR code and the panel has no start function to create it. */
  @Output() restart = new EventEmitter<void>();

  private remoteSessions = inject(RemoteSessionService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  readonly linkProblem = remoteLinkProblem();
  readonly canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  readonly isActive = isRemoteSessionActive;

  readonly current = signal<RemoteSession | null>(null);
  readonly creating = signal(false);
  readonly createError = signal('');
  readonly qrAgain = signal(false);
  readonly copied = signal(false);
  private readonly link = signal('');
  private readonly expiresAt = signal(0);
  private readonly now = signal(Date.now());

  readonly qr = computed(() => this.link() ? qrCode(this.link()) : null);
  readonly countdown = computed(() => {
    const seconds = Math.max(0, Math.ceil((this.expiresAt() - this.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  private creation?: Subscription;
  private poll?: Subscription;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  ngOnInit() {
    if (this.session) {
      this.use(this.session);
    } else {
      this.create();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['session'] && !changes['session'].firstChange && this.session) {
      this.use(this.session);
    } else if (changes['start'] && !changes['start'].firstChange && this.start && !this.session) {
      this.create();
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.creation?.unsubscribe();
    this.stopWatching();
    const session = this.current();
    if (session && isRemoteSessionActive(session)) {
      this.remoteSessions.cancel(this.userId, session.id).subscribe({ error: () => undefined });
    }
  }

  again() {
    if (this.start) {
      this.create();
    } else {
      this.restart.emit();
    }
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.copied.set(false);
    }
  }

  endTitle(session: RemoteSession): string {
    switch (session.status) {
      case 'declined': return 'Declined on your phone';
      case 'expired': return 'This QR code has expired';
      default: return 'This QR code is no longer valid';
    }
  }

  endText(session: RemoteSession): string {
    switch (session.status) {
      case 'declined': return 'Nothing was done. Show a new QR code to try again.';
      case 'expired': return 'For your security, a QR code is only valid for a few minutes.';
      default: return 'A newer request replaced it, or it was cancelled.';
    }
  }

  private create() {
    if (!this.start) return;
    const previous = this.current();
    this.creation?.unsubscribe();
    this.stopWatching();
    this.current.set(null);
    this.createError.set('');
    this.creating.set(true);
    if (previous && isRemoteSessionActive(previous)) {
      this.remoteSessions.cancel(this.userId, previous.id).subscribe({ error: () => undefined });
    }
    this.creation = this.start().subscribe({
      next: (session) => {
        this.creating.set(false);
        this.use(session);
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(httpErrorMessage(err, "Couldn't prepare the QR code. Try again."));
      }
    });
  }

  private use(session: RemoteSession) {
    if (session.token) {
      this.link.set(remoteLink(session.token));
    }
    this.qrAgain.set(false);
    this.update(session);
    if (isRemoteSessionActive(session)) {
      this.watch(session.id);
    }
  }

  private update(session: RemoteSession) {
    this.current.set(session);
    this.now.set(Date.now());
    this.expiresAt.set(Date.now() + Math.max(0, session.secondsLeft) * 1000);
    if (!isRemoteSessionActive(session)) {
      this.stopWatching();
      if (session.status === 'completed') {
        this.ngZone.run(() => this.completed.emit(session));
      }
    }
  }

  /** Outside the zone: the status and the countdown only refresh this panel, not the whole page. */
  private watch(sessionId: string) {
    this.stopWatching();
    this.ngZone.runOutsideAngular(() => {
      this.poll = timer(POLL_MS, POLL_MS).pipe(
        exhaustMap(() => this.remoteSessions.status(this.userId, sessionId).pipe(
          catchError((err) => {
            if (httpStatus(err) === 404) {
              const session = this.current();
              if (session) this.update({ ...session, status: 'expired', secondsLeft: 0 });
              this.render();
            }
            return EMPTY;
          })
        ))
      ).subscribe((session) => {
        this.update(session);
        this.render();
      });
      this.ticker = setInterval(() => {
        this.now.set(Date.now());
        this.render();
      }, 1000);
    });
  }

  private stopWatching() {
    this.poll?.unsubscribe();
    this.poll = undefined;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private render() {
    if (!this.destroyed) {
      this.cdr.detectChanges();
    }
  }
}
