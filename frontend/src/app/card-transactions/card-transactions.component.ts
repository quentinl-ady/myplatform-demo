import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  MyPlatformService,
  CardResponse,
  CardTransfer
} from '../my-platform-service';
import { MCC_CODES } from '../industry-codes';

@Component({
  selector: 'app-card-transactions',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="fintech-wrapper">

      <!-- Header -->
      <div class="page-header">
        <div class="header-content">
          <h1>Card Transactions</h1>
          <p class="subtitle">Authorizations, captures, refunds and more</p>
        </div>
        <button mat-flat-button class="fintech-btn primary" (click)="refresh()" [disabled]="isLoading">
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
      </div>

      <!-- Card Selector -->
      <div class="card-selector" *ngIf="cards.length > 0">
        <div class="selector-toggle" (click)="toggleCardDropdown()">
          <div class="selected-card-info" *ngIf="getSelectedCard() as card">
            <span class="sel-brand" [class.visa]="card.brand === 'visa'" [class.mc]="card.brand === 'mc'">{{ card.brand === 'visa' ? 'Visa' : 'MC' }}</span>
            <span class="sel-name">{{ card.cardholderName }}</span>
            <span class="sel-last4">&bull;&bull;&bull;&bull; {{ card.lastFour }}</span>
            <span class="sel-status" [ngClass]="card.status">{{ card.status }}</span>
          </div>
          <mat-icon class="sel-arrow" [class.open]="cardDropdownOpen">expand_more</mat-icon>
        </div>
        <div class="card-dropdown" *ngIf="cardDropdownOpen">
          <div class="card-option" *ngFor="let card of cards"
               [class.active]="card.paymentInstrumentId === selectedPaymentInstrumentId"
               (click)="selectCardFilter(card.paymentInstrumentId)">
            <span class="opt-brand" [class.visa]="card.brand === 'visa'" [class.mc]="card.brand === 'mc'">{{ card.brand === 'visa' ? 'Visa' : 'MC' }}</span>
            <span class="opt-name">{{ card.cardholderName }}</span>
            <span class="opt-last4">&bull;&bull;&bull;&bull; {{ card.lastFour }}</span>
            <span class="opt-status" [ngClass]="card.status">{{ card.status }}</span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div class="loading-state" *ngIf="isLoading">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading transactions...</p>
      </div>

      <!-- Empty State -->
      <div class="empty-state" *ngIf="!isLoading && transfers.length === 0">
        <mat-icon>receipt_long</mat-icon>
        <h3>No transactions found</h3>
        <p>No card transactions available for the selected filter</p>
      </div>

      <!-- Transactions List -->
      <div class="tx-list" *ngIf="!isLoading && transfers.length > 0">
        <div class="tx-list-header">
          <span class="col-date">Date</span>
          <span class="col-merchant">Merchant</span>
          <span class="col-type">Channel</span>
          <span class="col-status">Status</span>
          <span class="col-amount">Amount</span>
        </div>
        <div class="tx-row" *ngFor="let t of transfers" (click)="openDetail(t)">
          <span class="col-date">{{ formatDate(t.createdAt) }}</span>
          <div class="col-merchant">
            <span class="merchant-name">{{ t.merchantName || 'Unknown Merchant' }}</span>
            <span class="merchant-mcc" *ngIf="t.mcc">{{ t.mcc }} - {{ getMccLabel(t.mcc) }}</span>
          </div>
          <span class="col-type">
            <span class="channel-badge" [class.ecom]="t.processingType === 'ecommerce'" [class.pos]="t.processingType === 'pos'">
              {{ t.processingType === 'ecommerce' ? 'eCOM' : t.processingType === 'pos' ? 'POS' : (t.processingType || '-') }}
            </span>
          </span>
          <span class="col-status">
            <span class="status-badge" [ngClass]="'st-' + t.status">{{ t.status }}</span>
            <span class="tx-reason" *ngIf="t.reason">{{ formatReason(t.reason) }}</span>
          </span>
          <span class="col-amount">
            {{ formatAmount(t.amount) }} {{ t.currency }}
          </span>
        </div>
      </div>

      <!-- Detail Modal Overlay -->
      <div class="detail-overlay" *ngIf="selectedTransfer" (click)="closeDetail()">
        <div class="detail-modal" (click)="$event.stopPropagation()">

          <div class="modal-header">
            <h2>Transaction Details</h2>
            <button mat-icon-button (click)="closeDetail()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <div class="modal-body">

            <!-- Overview -->
            <div class="detail-section">
              <h3>Overview</h3>
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="label">Transfer ID</span>
                  <span class="value mono">{{ selectedTransfer.id }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Status</span>
                  <span class="status-badge" [ngClass]="'st-' + selectedTransfer.status">{{ selectedTransfer.status }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Amount</span>
                  <span class="value">{{ formatAmount(selectedTransfer.amount) }} {{ selectedTransfer.currency }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Type</span>
                  <span class="value">{{ selectedTransfer.type }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.description">
                  <span class="label">Description</span>
                  <span class="value">{{ selectedTransfer.description }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.reason">
                  <span class="label">Reason</span>
                  <span class="value reason-text">{{ formatReason(selectedTransfer.reason) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Processing</span>
                  <span class="value">{{ selectedTransfer.processingType || '-' }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.panEntryMode">
                  <span class="label">PAN Entry Mode</span>
                  <span class="value">{{ selectedTransfer.panEntryMode }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.authorisationType">
                  <span class="label">Authorisation Type</span>
                  <span class="value">{{ selectedTransfer.authorisationType }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Description</span>
                  <span class="value">{{ selectedTransfer.paymentInstrumentDescription || selectedTransfer.paymentInstrumentId }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Reference</span>
                  <span class="value mono">{{ selectedTransfer.reference }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Created</span>
                  <span class="value">{{ formatDateTime(selectedTransfer.createdAt) }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.updatedAt">
                  <span class="label">Updated</span>
                  <span class="value">{{ formatDateTime(selectedTransfer.updatedAt) }}</span>
                </div>
              </div>
            </div>

            <!-- Merchant -->
            <div class="detail-section" *ngIf="selectedTransfer.merchantName">
              <h3>Merchant</h3>
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="label">Name</span>
                  <span class="value">{{ selectedTransfer.merchantName }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.mcc">
                  <span class="label">MCC</span>
                  <span class="value"><strong>{{ selectedTransfer.mcc }}</strong> - {{ getMccLabel(selectedTransfer.mcc) }}</span>
                </div>
                <div class="detail-item" *ngIf="selectedTransfer.merchantCity || selectedTransfer.merchantCountry">
                  <span class="label">Location</span>
                  <span class="value">{{ formatLocation(selectedTransfer.merchantCity, selectedTransfer.merchantCountry) }}</span>
                </div>
              </div>
            </div>

            <!-- 3D Secure -->
            <div class="detail-section" *ngIf="selectedTransfer.threeDSecureAcsTransactionId">
              <h3>3D Secure</h3>
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="label">ACS Transaction ID</span>
                  <span class="value mono">{{ selectedTransfer.threeDSecureAcsTransactionId }}</span>
                </div>
              </div>
            </div>

            <!-- Lifecycle Events -->
            <div class="detail-section" *ngIf="selectedTransfer.events?.length">
              <h3>Lifecycle</h3>
              <div class="lifecycle-timeline">
                <div class="lifecycle-event" *ngFor="let event of selectedTransfer.events; let last = last">
                  <div class="event-dot-col">
                    <div class="event-dot" [ngClass]="'dot-' + event.status"></div>
                    <div class="event-line" *ngIf="!last"></div>
                  </div>
                  <div class="event-info">
                    <div class="event-header">
                      <span class="event-status" [ngClass]="'st-' + event.status">{{ event.status }}</span>
                      <span class="event-type">({{ event.type }})</span>
                    </div>
                    <div class="event-meta">
                      <span>{{ formatDateTime(event.bookingDate) }}</span>
                      <span class="event-amount">{{ formatAmount(event.amountValue) }} {{ event.amountCurrency }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Validation Facts -->
            <div class="detail-section" *ngIf="getInvalidFacts(selectedTransfer.validationFacts).length">
              <h3>Validation Checks</h3>
              <div class="validation-grid">
                <div class="validation-item" *ngFor="let fact of getInvalidFacts(selectedTransfer.validationFacts)"
                     [ngClass]="'vr-' + fact.result">
                  <mat-icon class="validation-icon">
                    {{ fact.result === 'valid' ? 'check_circle' : fact.result === 'invalid' ? 'cancel' : 'help_outline' }}
                  </mat-icon>
                  <span class="validation-type">{{ formatValidationType(fact.type) }}</span>
                  <span class="validation-result">{{ fact.result }}</span>
                </div>
              </div>
            </div>

            <!-- Transaction Rules Result -->
            <div class="detail-section" *ngIf="selectedTransfer.transactionRulesResult">
              <h3>Transaction Rules</h3>
              <div class="rules-result">
                <div class="rules-summary">
                  <span class="rules-advice" [class.deny]="selectedTransfer.transactionRulesResult.advice === 'DenyTransaction'">
                    {{ selectedTransfer.transactionRulesResult.advice }}
                  </span>
                  <span class="rules-passed" *ngIf="!selectedTransfer.transactionRulesResult.allHardBlockRulesPassed">
                    Hard block rules failed
                  </span>
                </div>
                <div class="triggered-rules" *ngIf="selectedTransfer.transactionRulesResult.triggeredRules?.length">
                  <div class="triggered-rule" *ngFor="let rule of selectedTransfer.transactionRulesResult.triggeredRules">
                    <div class="rule-header">
                      <mat-icon class="rule-block-icon">block</mat-icon>
                      <span class="rule-desc">{{ rule.ruleDescription }}</span>
                    </div>
                    <div class="rule-meta">
                      <span *ngIf="rule.reason">{{ rule.reason }}</span>
                      <span class="rule-outcome">{{ rule.outcomeType }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper { max-width: 960px; margin: 0 auto; padding: 0 16px; }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    .page-header h1 { font-size: 28px; font-weight: 700; margin: 0 0 8px 0; color: var(--fintech-text); }
    .page-header .subtitle { font-size: 15px; color: var(--fintech-text-secondary); margin: 0; }

    .fintech-btn {
      border-radius: 24px !important;
      padding: 8px 20px !important;
      font-weight: 600 !important;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .fintech-btn.primary { background-color: var(--fintech-primary) !important; color: white !important; }

    /* Card Selector */
    .card-selector {
      position: relative;
      max-width: 440px;
      margin-bottom: 24px;
    }
    .selector-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--fintech-surface);
      border: 1px solid var(--fintech-border);
      border-radius: 12px;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .selector-toggle:hover {
      border-color: #bdbdbd;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .selected-card-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sel-brand, .opt-brand {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .sel-brand.visa, .opt-brand.visa { background: #1a1f71; color: white; }
    .sel-brand.mc, .opt-brand.mc { background: #eb001b; color: white; }
    .sel-name, .opt-name { font-size: 14px; font-weight: 500; color: var(--fintech-text); }
    .sel-last4, .opt-last4 { font-size: 13px; color: var(--fintech-text-secondary); letter-spacing: 1px; }
    .sel-status, .opt-status {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .sel-status.active, .opt-status.active { background: #e8f5e9; color: #4caf50; }
    .sel-status.suspended, .opt-status.suspended { background: #fff3e0; color: #ff9800; }
    .sel-status.closed, .opt-status.closed { background: #f5f5f5; color: #9e9e9e; }
    .sel-status.inactive, .opt-status.inactive { background: #f5f5f5; color: #9e9e9e; }
    .sel-arrow {
      transition: transform 0.2s;
      color: var(--fintech-text-secondary);
    }
    .sel-arrow.open { transform: rotate(180deg); }
    .card-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: var(--fintech-surface);
      border: 1px solid var(--fintech-border);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      z-index: 100;
      overflow: hidden;
      animation: dropIn 0.15s ease;
    }
    @keyframes dropIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .card-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      cursor: pointer;
      transition: background 0.12s;
    }
    .card-option:hover { background: var(--fintech-bg); }
    .card-option.active { background: #f0f4ff; }

    /* Loading & Empty */
    .loading-state, .empty-state {
      text-align: center;
      padding: 64px 24px;
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
    }
    .loading-state mat-spinner { margin: 0 auto 16px; }
    .loading-state p { color: var(--fintech-text-secondary); }
    .empty-state mat-icon { font-size: 64px; width: 64px; height: 64px; color: var(--fintech-border); margin-bottom: 16px; }
    .empty-state h3 { margin: 0 0 8px; }
    .empty-state p { color: var(--fintech-text-secondary); margin: 0; }

    /* Transactions List */
    .tx-list {
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      overflow: hidden;
      border: 1px solid var(--fintech-border);
    }
    .tx-list-header {
      display: grid;
      grid-template-columns: 110px 1fr 80px 140px 120px;
      padding: 12px 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--fintech-text-secondary);
      border-bottom: 1px solid var(--fintech-border);
      background: var(--fintech-bg);
    }
    .tx-row {
      display: grid;
      grid-template-columns: 110px 1fr 80px 140px 120px;
      padding: 14px 20px;
      align-items: center;
      border-bottom: 1px solid var(--fintech-border);
      cursor: pointer;
      transition: background 0.15s;
    }
    .tx-row:last-child { border-bottom: none; }
    .tx-row:hover { background: var(--fintech-bg); }

    .col-date { font-size: 13px; color: var(--fintech-text-secondary); }
    .col-merchant { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .merchant-name { font-size: 14px; font-weight: 500; color: var(--fintech-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .merchant-mcc { font-size: 11px; color: var(--fintech-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .channel-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--fintech-bg);
      color: var(--fintech-text-secondary);
    }
    .channel-badge.ecom { background: #e3f2fd; color: #1565c0; }
    .channel-badge.pos { background: #f3e5f5; color: #7b1fa2; }

    .col-status { display: flex; flex-direction: column; gap: 2px; }
    .status-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: capitalize;
      width: fit-content;
    }
    .st-booked, .st-captured { background: #e8f5e9; color: #2e7d32; }
    .st-authorised { background: #e3f2fd; color: #1565c0; }
    .st-refused { background: #ffebee; color: #c62828; }
    .st-received { background: #fff8e1; color: #f57f17; }
    .st-refunded, .st-refundPending { background: #fce4ec; color: #ad1457; }
    .st-expired { background: #efebe9; color: #4e342e; }

    .tx-reason { font-size: 11px; color: #c62828; }

    .col-amount { font-size: 14px; font-weight: 600; text-align: right; color: var(--fintech-text); }
    .col-amount.negative { color: var(--fintech-text); }

    /* Detail Modal Overlay */
    .detail-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .detail-modal {
      background: var(--fintech-surface);
      border-radius: 20px;
      width: 640px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      animation: slideUp 0.25s ease;
    }
    @keyframes slideUp {
      from { transform: translateY(30px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 28px 16px;
      border-bottom: 1px solid var(--fintech-border);
      flex-shrink: 0;
    }
    .modal-header h2 { margin: 0; font-size: 20px; font-weight: 700; }

    .modal-body {
      padding: 20px 28px 28px;
      overflow-y: auto;
      flex: 1;
    }

    .detail-section { margin-bottom: 28px; }
    .detail-section:last-child { margin-bottom: 0; }
    .detail-section h3 {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--fintech-text-secondary);
      margin: 0 0 14px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--fintech-border);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px 24px;
    }
    .detail-item { display: flex; flex-direction: column; gap: 3px; }
    .detail-item .label { font-size: 11px; font-weight: 600; color: var(--fintech-text-secondary); text-transform: uppercase; letter-spacing: 0.3px; }
    .detail-item .value { font-size: 14px; color: var(--fintech-text); word-break: break-all; }
    .detail-item .value.mono { font-family: 'SF Mono', SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .detail-item .value.reason-text { color: #c62828; font-weight: 500; }

    /* Lifecycle Timeline */
    .lifecycle-timeline { display: flex; flex-direction: column; }
    .lifecycle-event { display: flex; gap: 14px; }
    .event-dot-col { display: flex; flex-direction: column; align-items: center; width: 18px; flex-shrink: 0; }
    .event-dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      background: var(--fintech-border);
      margin-top: 4px;
      flex-shrink: 0;
    }
    .dot-booked, .dot-captured { background: #4caf50; }
    .dot-authorised { background: #1976d2; }
    .dot-refused { background: #e53935; }
    .dot-received { background: #ff9800; }
    .dot-refunded { background: #e91e63; }
    .event-line { width: 2px; flex: 1; background: var(--fintech-border); min-height: 20px; }

    .event-info { padding-bottom: 16px; flex: 1; }
    .event-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .event-status { font-size: 13px; font-weight: 600; text-transform: capitalize; }
    .event-type { font-size: 12px; color: var(--fintech-text-secondary); }
    .event-meta { display: flex; gap: 12px; font-size: 12px; color: var(--fintech-text-secondary); }
    .event-amount { font-weight: 500; }

    /* Validation Grid */
    .validation-grid { display: flex; flex-direction: column; gap: 6px; }
    .validation-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--fintech-bg);
      font-size: 13px;
    }
    .validation-icon { font-size: 18px; width: 18px; height: 18px; }
    .vr-valid .validation-icon { color: #4caf50; }
    .vr-invalid .validation-icon { color: #e53935; }
    .vr-notValidated .validation-icon, .vr-notApplicable .validation-icon { color: #bdbdbd; }
    .validation-type { flex: 1; color: var(--fintech-text); }
    .validation-result {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .vr-valid .validation-result { background: #e8f5e9; color: #2e7d32; }
    .vr-invalid .validation-result { background: #ffebee; color: #c62828; }
    .vr-notValidated .validation-result { background: #f5f5f5; color: #9e9e9e; }
    .vr-notApplicable .validation-result { background: #f5f5f5; color: #9e9e9e; }

    /* Transaction Rules */
    .rules-result { display: flex; flex-direction: column; gap: 12px; }
    .rules-summary { display: flex; gap: 12px; align-items: center; }
    .rules-advice {
      font-size: 13px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 6px;
      background: #e8f5e9;
      color: #2e7d32;
    }
    .rules-advice.deny { background: #ffebee; color: #c62828; }
    .rules-passed { font-size: 12px; color: #c62828; font-weight: 500; }

    .triggered-rules { display: flex; flex-direction: column; gap: 8px; }
    .triggered-rule {
      padding: 12px 14px;
      background: #fff3e0;
      border-radius: 8px;
      border-left: 3px solid #ff9800;
    }
    .rule-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .rule-block-icon { font-size: 16px; width: 16px; height: 16px; color: #e65100; }
    .rule-desc { font-size: 13px; font-weight: 600; color: var(--fintech-text); }
    .rule-meta { display: flex; gap: 12px; font-size: 12px; color: var(--fintech-text-secondary); padding-left: 24px; }
    .rule-outcome {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: #ffccbc;
      color: #bf360c;
      text-transform: uppercase;
    }
  `]
})
export class CardTransactionsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(MyPlatformService);
  private snack = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  cards: CardResponse[] = [];
  transfers: CardTransfer[] = [];
  selectedPaymentInstrumentId = '';
  selectedTransfer?: CardTransfer;
  isLoading = false;
  isLoadingCards = false;
  cardDropdownOpen = false;

  allMccs = MCC_CODES;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadCards();
      }
    });
  }

  loadCards() {
    this.isLoadingCards = true;
    this.service.getCards(Number(this.userId)).subscribe({
      next: (cards) => {
        this.cards = cards;
        this.isLoadingCards = false;
        if (this.cards.length > 0 && !this.selectedPaymentInstrumentId) {
          this.selectedPaymentInstrumentId = this.cards[0].paymentInstrumentId;
        }
        this.loadTransfers();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingCards = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadTransfers() {
    this.isLoading = true;
    this.cdr.detectChanges();

    if (!this.selectedPaymentInstrumentId) {
      this.isLoading = false;
      this.transfers = [];
      this.cdr.detectChanges();
      return;
    }

    const piId = this.selectedPaymentInstrumentId;

    this.service.getCardTransfers(Number(this.userId), piId).subscribe({
      next: (transfers) => {
        this.transfers = transfers;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.transfers = [];
        this.isLoading = false;
        this.snack.open('Failed to load card transactions', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  getSelectedCard(): CardResponse | undefined {
    return this.cards.find(c => c.paymentInstrumentId === this.selectedPaymentInstrumentId);
  }

  toggleCardDropdown() {
    this.cardDropdownOpen = !this.cardDropdownOpen;
  }

  selectCardFilter(piId: string) {
    this.selectedPaymentInstrumentId = piId;
    this.cardDropdownOpen = false;
    this.loadTransfers();
  }

  onCardFilterChange() {
    this.loadTransfers();
  }

  refresh() {
    this.loadTransfers();
  }

  openDetail(transfer: CardTransfer) {
    this.selectedTransfer = transfer;
    this.cdr.detectChanges();
  }

  closeDetail() {
    this.selectedTransfer = undefined;
    this.cdr.detectChanges();
  }

  getMccLabel(code: string): string {
    const mcc = this.allMccs.find(m => m.code === code);
    return mcc ? mcc.label : code;
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

  formatReason(reason: string): string {
    if (!reason) return '';
    return reason.replace(/([A-Z])/g, ' $1').trim();
  }

  formatValidationType(type: string): string {
    if (!type) return '';
    return type.replace(/([A-Z])/g, ' $1').trim();
  }

  getInvalidFacts(facts: any[]): any[] {
    return facts ? facts.filter(f => f.result === 'invalid') : [];
  }

  formatLocation(city?: string, country?: string): string {
    return [city, country].filter(Boolean).join(', ');
  }

  // Helper used in template for array filtering
  filter(arr: any[], fn: (x: any) => boolean): any[] {
    return arr ? arr.filter(fn) : [];
  }
}
