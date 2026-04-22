import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule } from '@angular/material/dialog';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

import {
  MyPlatformService,
  User,
  CardResponse,
  TransactionRuleResponse,
  AddTransactionRuleRequest
} from '../my-platform-service';
import { FormatCardNumberPipe } from './format-card-number.pipe';
import { MCC_CODES } from '../industry-codes';

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatSnackBarModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatDialogModule,
    MatAutocompleteModule,
    FormatCardNumberPipe
  ],
  template: `
    <div class="fintech-wrapper">
      <div class="page-header">
        <div class="header-content">
          <h1>My Cards</h1>
          <p class="subtitle">Manage your virtual cards and spending rules</p>
        </div>
        <button mat-flat-button class="fintech-btn primary" (click)="navigateToCreate()">
          <mat-icon>add</mat-icon>
          New Card
        </button>
      </div>

      <!-- Search Bar -->
      <div class="search-bar" *ngIf="!isLoadingActive || activeCards.length > 0 || suspendedCards.length > 0">
        <div class="search-container">
          <mat-icon class="search-icon">search</mat-icon>
          <input type="text"
                 class="fintech-input search-input"
                 placeholder="Search by cardholder name..."
                 [formControl]="searchControl"
                 [matAutocomplete]="searchAuto" />
          <mat-autocomplete #searchAuto="matAutocomplete" (optionSelected)="onSearchSelect($event)">
            <mat-option *ngFor="let card of searchSuggestions" [value]="card">
              <div class="search-suggestion">
                <span class="suggestion-name">{{ card.cardholderName }}</span>
                <span class="suggestion-meta">
                  <span class="suggestion-brand" [class.visa]="card.brand === 'visa'" [class.mc]="card.brand === 'mc'">{{ card.brand === 'visa' ? 'Visa' : 'MC' }}</span>
                  •••• {{ card.lastFour }}
                  <span class="suggestion-status" [class]="card.status">{{ card.status }}</span>
                </span>
              </div>
            </mat-option>
          </mat-autocomplete>
          <button *ngIf="searchControl.value" class="search-clear" (click)="clearSearch()">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <div class="loading-state" *ngIf="isLoadingActive">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading your cards...</p>
      </div>

      <div class="empty-state" *ngIf="!isLoadingActive && activeCards.length === 0 && suspendedCards.length === 0 && closedCards.length === 0">
        <mat-icon>credit_card_off</mat-icon>
        <h3>No cards yet</h3>
        <p>Create your first virtual card to get started</p>
        <button mat-flat-button class="fintech-btn primary" (click)="navigateToCreate()">
          Create Card
        </button>
      </div>

      <!-- Active Cards Section -->
      <div class="cards-section" *ngIf="filteredActiveCards.length > 0">
        <div class="section-title">
          <span class="status-dot active"></span>
          <h2>Active</h2>
          <span class="card-count">{{ filteredActiveCards.length }}</span>
        </div>
        <div class="cards-grid">
          <div class="card-item" *ngFor="let card of filteredActiveCards" [class.selected]="selectedCard?.paymentInstrumentId === card.paymentInstrumentId">

          <div class="virtual-card"
               [class.visa]="card.brand === 'visa'"
               [class.mc]="card.brand === 'mc'"
               [class.suspended]="card.status === 'suspended'"
               [class.closed]="card.status === 'closed'"
               (click)="selectCard(card)">

            <div class="card-status-badge" *ngIf="card.status !== 'active'">
              {{ card.status | titlecase }}
            </div>

            <div class="card-top-row">
              <div class="card-brand-logo">
                <svg *ngIf="card.brand === 'visa'" viewBox="0 0 750 471" xmlns="http://www.w3.org/2000/svg">
                  <path d="M278.198 334.228l33.36-195.763h53.358l-33.384 195.763h-53.334zm246.11-191.54c-10.57-3.966-27.135-8.222-47.822-8.222-52.725 0-89.863 26.551-90.18 64.604-.297 28.129 26.514 43.821 46.754 53.185 20.77 9.597 27.752 15.716 27.652 24.283-.133 13.123-16.586 19.116-31.924 19.116-21.355 0-32.701-2.967-50.225-10.274l-6.878-3.112-7.487 43.822c12.463 5.466 35.508 10.199 59.438 10.445 56.09 0 92.502-26.248 92.916-66.884.199-22.27-14.016-39.216-44.801-53.188-18.65-9.056-30.072-15.099-29.951-24.269 0-8.137 9.668-16.838 30.559-16.838 17.447-.271 30.088 3.534 39.936 7.5l4.781 2.259 7.232-42.427m137.308-4.223h-41.23c-12.773 0-22.332 3.486-27.941 16.234l-79.244 179.402h56.031s9.16-24.121 11.232-29.418c6.123 0 60.555.084 68.336.084 1.596 6.854 6.492 29.334 6.492 29.334h49.512l-43.188-195.636zm-65.417 126.408c4.414-11.279 21.26-54.724 21.26-54.724-.314.521 4.381-11.334 7.074-18.684l3.607 16.878s10.217 46.729 12.352 56.527h-44.293v.003zM185.213 138.465L133.188 271.94l-5.562-27.129c-9.726-31.274-40.025-65.157-73.898-82.12l47.767 171.204 56.455-.064 84.004-195.386h-56.741" fill="#fff"/>
                </svg>
                <svg *ngIf="card.brand === 'mc'" viewBox="0 0 152 100" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="50" cy="50" r="45" fill="#eb001b"/>
                  <circle cx="102" cy="50" r="45" fill="#f79e1b"/>
                  <path d="M76 18.5a45 45 0 0 0 0 63 45 45 0 0 0 0-63z" fill="#ff5f00"/>
                </svg>
              </div>
              <button mat-icon-button [matMenuTriggerFor]="cardMenu" class="card-menu-btn" (click)="$event.stopPropagation()">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #cardMenu="matMenu">
                <button mat-menu-item (click)="revealCardDetails(card)" [disabled]="card.status === 'closed'">
                  <mat-icon>visibility</mat-icon>
                  <span>Reveal Details</span>
                </button>
                <button mat-menu-item (click)="suspendCard(card)" *ngIf="card.status === 'active'">
                  <mat-icon>pause_circle</mat-icon>
                  <span>Suspend Card</span>
                </button>
                <button mat-menu-item (click)="activateCard(card)" *ngIf="card.status === 'suspended'">
                  <mat-icon>play_circle</mat-icon>
                  <span>Reactivate Card</span>
                </button>
                <button mat-menu-item (click)="closeCard(card)" *ngIf="card.status !== 'closed'" class="danger-item">
                  <mat-icon>cancel</mat-icon>
                  <span>Close Card</span>
                </button>
              </mat-menu>
            </div>

            <div class="card-number" [class.revealed]="revealedCardId === card.paymentInstrumentId">
              <span *ngIf="revealedCardId !== card.paymentInstrumentId || !revealedData">
                •••• •••• •••• {{ card.lastFour }}
              </span>
              <span *ngIf="revealedCardId === card.paymentInstrumentId && revealedData" class="revealed-number">
                {{ revealedData.pan | formatCardNumber }}
              </span>
            </div>

            <div class="card-bottom-row">
              <div class="card-holder">
                <span class="label">CARDHOLDER</span>
                <span class="value">{{ card.cardholderName }}</span>
              </div>
              <div class="card-expiry">
                <span class="label">EXPIRES</span>
                <span class="value" *ngIf="revealedCardId !== card.paymentInstrumentId || !revealedData">
                  {{ card.expiryMonth }}/{{ card.expiryYear?.slice(-2) }}
                </span>
                <span class="value" *ngIf="revealedCardId === card.paymentInstrumentId && revealedData">
                  {{ revealedData.expiryMonth }}/{{ revealedData.expiryYear?.toString()?.slice(-2) }}
                </span>
              </div>
              <div class="card-cvv" *ngIf="revealedCardId === card.paymentInstrumentId && revealedData">
                <span class="label">CVV</span>
                <span class="value">{{ revealedData.cvc }}</span>
              </div>
            </div>
          </div>

          <div class="card-actions-quick" *ngIf="selectedCard?.paymentInstrumentId === card.paymentInstrumentId">
            <button class="action-btn" (click)="revealCardDetails(card)" [disabled]="card.status === 'closed' || isRevealing">
              <mat-icon>{{ revealedCardId === card.paymentInstrumentId ? 'visibility_off' : 'visibility' }}</mat-icon>
              <span>{{ revealedCardId === card.paymentInstrumentId ? 'Hide' : 'Reveal' }}</span>
            </button>
            <button class="action-btn" (click)="openRulesPanel(card)">
              <mat-icon>rule</mat-icon>
              <span>Rules</span>
            </button>
            <button class="action-btn" (click)="copyCardNumber(card)" [disabled]="revealedCardId !== card.paymentInstrumentId">
              <mat-icon>content_copy</mat-icon>
              <span>Copy</span>
            </button>
          </div>
          </div>
        </div>
      </div>

      <!-- Suspended Cards Section -->
      <div class="cards-section" *ngIf="filteredSuspendedCards.length > 0">
        <div class="section-title">
          <span class="status-dot suspended"></span>
          <h2>Suspended</h2>
          <span class="card-count">{{ filteredSuspendedCards.length }}</span>
        </div>
        <div class="cards-grid">
          <div class="card-item" *ngFor="let card of filteredSuspendedCards" [class.selected]="selectedCard?.paymentInstrumentId === card.paymentInstrumentId">

            <div class="virtual-card"
                 [class.visa]="card.brand === 'visa'"
                 [class.mc]="card.brand === 'mc'"
                 [class.suspended]="true"
                 (click)="selectCard(card)">

              <div class="card-status-badge">Suspended</div>

              <div class="card-top-row">
                <div class="card-brand-logo">
                  <svg *ngIf="card.brand === 'visa'" viewBox="0 0 750 471" xmlns="http://www.w3.org/2000/svg">
                    <path d="M278.198 334.228l33.36-195.763h53.358l-33.384 195.763h-53.334zm246.11-191.54c-10.57-3.966-27.135-8.222-47.822-8.222-52.725 0-89.863 26.551-90.18 64.604-.297 28.129 26.514 43.821 46.754 53.185 20.77 9.597 27.752 15.716 27.652 24.283-.133 13.123-16.586 19.116-31.924 19.116-21.355 0-32.701-2.967-50.225-10.274l-6.878-3.112-7.487 43.822c12.463 5.466 35.508 10.199 59.438 10.445 56.09 0 92.502-26.248 92.916-66.884.199-22.27-14.016-39.216-44.801-53.188-18.65-9.056-30.072-15.099-29.951-24.269 0-8.137 9.668-16.838 30.559-16.838 17.447-.271 30.088 3.534 39.936 7.5l4.781 2.259 7.232-42.427m137.308-4.223h-41.23c-12.773 0-22.332 3.486-27.941 16.234l-79.244 179.402h56.031s9.16-24.121 11.232-29.418c6.123 0 60.555.084 68.336.084 1.596 6.854 6.492 29.334 6.492 29.334h49.512l-43.188-195.636zm-65.417 126.408c4.414-11.279 21.26-54.724 21.26-54.724-.314.521 4.381-11.334 7.074-18.684l3.607 16.878s10.217 46.729 12.352 56.527h-44.293v.003zM185.213 138.465L133.188 271.94l-5.562-27.129c-9.726-31.274-40.025-65.157-73.898-82.12l47.767 171.204 56.455-.064 84.004-195.386h-56.741" fill="#fff"/>
                  </svg>
                  <svg *ngIf="card.brand === 'mc'" viewBox="0 0 152 100" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="50" cy="50" r="45" fill="#eb001b"/>
                    <circle cx="102" cy="50" r="45" fill="#f79e1b"/>
                    <path d="M76 18.5a45 45 0 0 0 0 63 45 45 0 0 0 0-63z" fill="#ff5f00"/>
                  </svg>
                </div>
                <button mat-icon-button [matMenuTriggerFor]="suspCardMenu" class="card-menu-btn" (click)="$event.stopPropagation()">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #suspCardMenu="matMenu">
                  <button mat-menu-item (click)="revealCardDetails(card)">
                    <mat-icon>visibility</mat-icon>
                    <span>Reveal Details</span>
                  </button>
                  <button mat-menu-item (click)="activateCard(card)">
                    <mat-icon>play_circle</mat-icon>
                    <span>Reactivate Card</span>
                  </button>
                  <button mat-menu-item (click)="closeCard(card)" class="danger-item">
                    <mat-icon>cancel</mat-icon>
                    <span>Close Card</span>
                  </button>
                </mat-menu>
              </div>

              <div class="card-number" [class.revealed]="revealedCardId === card.paymentInstrumentId">
                <span *ngIf="revealedCardId !== card.paymentInstrumentId || !revealedData">
                  •••• •••• •••• {{ card.lastFour }}
                </span>
                <span *ngIf="revealedCardId === card.paymentInstrumentId && revealedData" class="revealed-number">
                  {{ revealedData.pan | formatCardNumber }}
                </span>
              </div>

              <div class="card-bottom-row">
                <div class="card-holder">
                  <span class="label">CARDHOLDER</span>
                  <span class="value">{{ card.cardholderName }}</span>
                </div>
                <div class="card-expiry">
                  <span class="label">EXPIRES</span>
                  <span class="value" *ngIf="revealedCardId !== card.paymentInstrumentId || !revealedData">
                    {{ card.expiryMonth }}/{{ card.expiryYear?.slice(-2) }}
                  </span>
                  <span class="value" *ngIf="revealedCardId === card.paymentInstrumentId && revealedData">
                    {{ revealedData.expiryMonth }}/{{ revealedData.expiryYear?.toString()?.slice(-2) }}
                  </span>
                </div>
                <div class="card-cvv" *ngIf="revealedCardId === card.paymentInstrumentId && revealedData">
                  <span class="label">CVV</span>
                  <span class="value">{{ revealedData.cvc }}</span>
                </div>
              </div>
            </div>

            <div class="card-actions-quick" *ngIf="selectedCard?.paymentInstrumentId === card.paymentInstrumentId">
              <button class="action-btn" (click)="revealCardDetails(card)" [disabled]="isRevealing">
                <mat-icon>{{ revealedCardId === card.paymentInstrumentId ? 'visibility_off' : 'visibility' }}</mat-icon>
                <span>{{ revealedCardId === card.paymentInstrumentId ? 'Hide' : 'Reveal' }}</span>
              </button>
              <button class="action-btn" (click)="openRulesPanel(card)">
                <mat-icon>rule</mat-icon>
                <span>Rules</span>
              </button>
              <button class="action-btn" (click)="copyCardNumber(card)" [disabled]="revealedCardId !== card.paymentInstrumentId">
                <mat-icon>content_copy</mat-icon>
                <span>Copy</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Closed Cards Section -->
      <div class="cards-section closed-section">
        <button class="show-closed-btn" (click)="loadClosedCards()" *ngIf="!closedCardsLoaded && !isLoadingClosed">
          <mat-icon>inventory_2</mat-icon>
          Show Closed Cards
        </button>
        <div class="loading-state small" *ngIf="isLoadingClosed">
          <mat-spinner diameter="24"></mat-spinner>
          <p>Loading closed cards...</p>
        </div>
        <div *ngIf="closedCardsLoaded && closedCards.length > 0">
          <div class="section-title">
            <span class="status-dot closed"></span>
            <h2>Closed</h2>
            <span class="card-count">{{ closedCards.length }}</span>
          </div>
          <div class="cards-grid">
            <div class="card-item" *ngFor="let card of closedCards">
              <div class="virtual-card"
                   [class.visa]="card.brand === 'visa'"
                   [class.mc]="card.brand === 'mc'"
                   [class.closed]="true">
                <div class="card-status-badge">Closed</div>
                <div class="card-top-row">
                  <div class="card-brand-logo">
                    <svg *ngIf="card.brand === 'visa'" viewBox="0 0 750 471" xmlns="http://www.w3.org/2000/svg">
                      <path d="M278.198 334.228l33.36-195.763h53.358l-33.384 195.763h-53.334zm246.11-191.54c-10.57-3.966-27.135-8.222-47.822-8.222-52.725 0-89.863 26.551-90.18 64.604-.297 28.129 26.514 43.821 46.754 53.185 20.77 9.597 27.752 15.716 27.652 24.283-.133 13.123-16.586 19.116-31.924 19.116-21.355 0-32.701-2.967-50.225-10.274l-6.878-3.112-7.487 43.822c12.463 5.466 35.508 10.199 59.438 10.445 56.09 0 92.502-26.248 92.916-66.884.199-22.27-14.016-39.216-44.801-53.188-18.65-9.056-30.072-15.099-29.951-24.269 0-8.137 9.668-16.838 30.559-16.838 17.447-.271 30.088 3.534 39.936 7.5l4.781 2.259 7.232-42.427m137.308-4.223h-41.23c-12.773 0-22.332 3.486-27.941 16.234l-79.244 179.402h56.031s9.16-24.121 11.232-29.418c6.123 0 60.555.084 68.336.084 1.596 6.854 6.492 29.334 6.492 29.334h49.512l-43.188-195.636zm-65.417 126.408c4.414-11.279 21.26-54.724 21.26-54.724-.314.521 4.381-11.334 7.074-18.684l3.607 16.878s10.217 46.729 12.352 56.527h-44.293v.003zM185.213 138.465L133.188 271.94l-5.562-27.129c-9.726-31.274-40.025-65.157-73.898-82.12l47.767 171.204 56.455-.064 84.004-195.386h-56.741" fill="#fff"/>
                    </svg>
                    <svg *ngIf="card.brand === 'mc'" viewBox="0 0 152 100" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="50" cy="50" r="45" fill="#eb001b"/>
                      <circle cx="102" cy="50" r="45" fill="#f79e1b"/>
                      <path d="M76 18.5a45 45 0 0 0 0 63 45 45 0 0 0 0-63z" fill="#ff5f00"/>
                    </svg>
                  </div>
                </div>
                <div class="card-number">•••• •••• •••• {{ card.lastFour }}</div>
                <div class="card-bottom-row">
                  <div class="card-holder">
                    <span class="label">CARDHOLDER</span>
                    <span class="value">{{ card.cardholderName }}</span>
                  </div>
                  <div class="card-expiry">
                    <span class="label">EXPIRES</span>
                    <span class="value">{{ card.expiryMonth }}/{{ card.expiryYear?.slice(-2) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="no-closed" *ngIf="closedCardsLoaded && closedCards.length === 0">No closed cards.</p>
      </div>

      <!-- Rules Panel -->
      <div class="rules-panel" *ngIf="showRulesPanel && selectedCard">
        <div class="panel-fixed-header">
          <div class="panel-header">
            <h3>Transaction Rules</h3>
            <button mat-icon-button (click)="closeRulesPanel()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <p class="panel-subtitle">Card ending in {{ selectedCard.lastFour }}</p>
        </div>

        <div class="panel-scrollable-content">
          <div class="rules-list" *ngIf="selectedCard?.transactionRules?.length">
            <div class="rule-item" *ngFor="let rule of selectedCard.transactionRules" [class.mcc-rule]="rule.type === 'blockedMccs'">
              <div class="rule-info">
                <mat-icon class="rule-icon">{{ getRuleIcon(rule.type) }}</mat-icon>
                <div class="rule-details">
                  <span class="rule-name">{{ getRuleName(rule.type) }}</span>
                  <span class="rule-value" *ngIf="rule.type === 'maxTransactions'">
                    {{ rule.value }} transactions
                  </span>
                  <span class="rule-value" *ngIf="rule.type !== 'maxTransactions' && rule.type !== 'blockedMccs'">
                    {{ (rule.value || 0) / 100 | number:'1.2-2' }} {{ rule.currencyCode }}
                  </span>
                  <div class="mcc-list" *ngIf="rule.type === 'blockedMccs' && rule.blockedMccs">
                    <span class="mcc-tag" *ngFor="let mcc of rule.blockedMccs">
                      <span class="mcc-code">{{ mcc }}</span>
                      <span class="mcc-label">{{ getMccLabel(mcc) }}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div class="rule-actions">
                <span class="rule-status" [class.active]="rule.status === 'active'" [class.inactive]="rule.status === 'inactive'">
                  {{ rule.status }}
                </span>
                <button mat-icon-button [matMenuTriggerFor]="ruleMenu">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #ruleMenu="matMenu">
                  <button mat-menu-item (click)="toggleRuleStatus(rule)" *ngIf="rule.status === 'active'">
                    <mat-icon>pause</mat-icon>
                    <span>Disable</span>
                  </button>
                  <button mat-menu-item (click)="toggleRuleStatus(rule)" *ngIf="rule.status === 'inactive'">
                    <mat-icon>play_arrow</mat-icon>
                    <span>Enable</span>
                  </button>
                  <button mat-menu-item (click)="deleteRule(rule)" class="danger-item">
                    <mat-icon>delete</mat-icon>
                    <span>Delete</span>
                  </button>
                </mat-menu>
              </div>
            </div>
          </div>

          <div class="no-rules" *ngIf="!selectedCard.transactionRules || selectedCard.transactionRules.length === 0">
            <mat-icon>info</mat-icon>
            <p>No rules configured for this card</p>
          </div>
        </div>

        <div class="panel-fixed-footer">
          <h4>Add New Rule</h4>
          <form [formGroup]="ruleForm" (ngSubmit)="addRule()">
            <select class="fintech-input full-width" formControlName="type" (change)="onRuleTypeChange()">
              <option value="maxTransactions">Transaction limit</option>
              <option value="maxAmountPerTransaction">Max amount per transaction</option>
              <option value="maxTotalAmount">Total spending limit</option>
              <option value="blockedMccs">Block merchant categories</option>
            </select>

            <div class="rule-form-row" *ngIf="ruleForm.value.type !== 'blockedMccs'">
              <input type="number" class="fintech-input" formControlName="value"
                     [step]="ruleForm.value.type === 'maxTransactions' ? '1' : '0.01'"
                     [placeholder]="ruleForm.value.type === 'maxTransactions' ? 'Count' : 'Amount (e.g. 15.00)'" />
              <button mat-flat-button class="fintech-btn primary" type="submit"
                      [disabled]="ruleForm.invalid || isAddingRule">
                <mat-spinner *ngIf="isAddingRule" diameter="20"></mat-spinner>
                <span *ngIf="!isAddingRule">Add</span>
              </button>
            </div>

            <div class="mcc-form-section" *ngIf="ruleForm.value.type === 'blockedMccs'">
              <div class="mcc-search-container">
                <mat-icon class="search-icon">search</mat-icon>
                <input type="text" 
                       class="fintech-input mcc-search" 
                       placeholder="Search merchant categories..."
                       [formControl]="mccSearchControl"
                       [matAutocomplete]="mccAuto" />
                <mat-autocomplete #mccAuto="matAutocomplete" (optionSelected)="addMccToRule($event)">
                  <mat-option *ngFor="let mcc of filteredMccs" [value]="mcc">
                    <span class="mcc-option" [class.risky]="mcc.risky">
                      <span class="mcc-code" [class.risky]="mcc.risky">{{ mcc.code }}</span>
                      <span class="mcc-label">{{ mcc.label }}</span>
                      <span class="risky-badge" *ngIf="mcc.risky">⚠ Risk</span>
                    </span>
                  </mat-option>
                </mat-autocomplete>
              </div>

              <div class="selected-mccs-panel" *ngIf="selectedMccsForRule.length > 0">
                <div class="mcc-chip" *ngFor="let mcc of selectedMccsForRule" [class.risky]="mcc.risky">
                  <span class="chip-code" [class.risky]="mcc.risky">{{ mcc.code }}</span>
                  <span class="chip-label">{{ mcc.label }}</span>
                  <span class="risky-indicator" *ngIf="mcc.risky">⚠</span>
                  <button type="button" class="chip-remove" (click)="removeMccFromRule(mcc)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              </div>

              <button mat-flat-button class="fintech-btn primary full-width mcc-add-btn" type="submit"
                      [disabled]="selectedMccsForRule.length === 0 || isAddingRule">
                <mat-spinner *ngIf="isAddingRule" diameter="20"></mat-spinner>
                <span *ngIf="!isAddingRule">Add MCC Block Rule</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Reveal Loading Overlay -->
      <div class="reveal-overlay" *ngIf="isRevealing">
        <div class="reveal-content">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Securely revealing card details...</p>
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
      --visa-gradient: linear-gradient(135deg, #1a1f71 0%, #2d4aa8 100%);
      --mc-gradient: linear-gradient(135deg, #eb001b 0%, #f79e1b 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper { max-width: 900px; margin: 0 auto; padding: 0 16px; }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
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

    .loading-state, .empty-state {
      text-align: center;
      padding: 64px 24px;
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
    }
    .loading-state mat-spinner, .empty-state mat-icon { margin: 0 auto 16px; }
    .empty-state mat-icon { font-size: 64px; width: 64px; height: 64px; color: var(--fintech-border); }
    .empty-state h3 { margin: 0 0 8px; }
    .empty-state p { color: var(--fintech-text-secondary); margin: 0 0 24px; }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
    }

    .card-item {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card-item.selected .virtual-card {
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      transform: translateY(-4px);
    }

    .virtual-card {
      background: var(--visa-gradient);
      border-radius: 16px;
      padding: 20px;
      color: white;
      aspect-ratio: 1.586;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      cursor: pointer;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    .virtual-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.12); }
    .virtual-card.mc { background: var(--mc-gradient); }
    .virtual-card.suspended { filter: grayscale(0.5); opacity: 0.8; }
    .virtual-card.closed { filter: grayscale(1); opacity: 0.6; }

    .card-status-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0,0,0,0.5);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .card-top-row { display: flex; justify-content: space-between; align-items: flex-start; }
    .card-brand-logo { height: 36px; width: 80px; }
    .card-brand-logo svg { height: 100%; width: auto; }
    .card-menu-btn { color: white !important; }

    .card-number {
      font-size: 20px;
      letter-spacing: 3px;
      font-weight: 500;
      transition: all 0.3s ease;
    }
    .card-number.revealed { animation: revealPulse 0.5s ease; }
    .revealed-number { letter-spacing: 2px; }

    @keyframes revealPulse {
      0% { opacity: 0; transform: scale(0.95); }
      100% { opacity: 1; transform: scale(1); }
    }

    .card-bottom-row { display: flex; gap: 24px; }
    .card-bottom-row .label { display: block; font-size: 9px; opacity: 0.7; margin-bottom: 2px; letter-spacing: 0.5px; }
    .card-bottom-row .value { font-size: 13px; font-weight: 500; text-transform: uppercase; }
    .card-cvv {
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 6px;
      animation: revealPulse 0.5s ease;
    }

    .card-actions-quick {
      display: flex;
      gap: 8px;
      background: var(--fintech-surface);
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .action-btn {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 8px;
      border: none;
      background: var(--fintech-bg);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      color: var(--fintech-text);
    }
    .action-btn:hover:not(:disabled) { background: var(--fintech-border); }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .action-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .action-btn span { font-size: 11px; font-weight: 500; }

    /* Rules Panel */
    .rules-panel {
      position: fixed;
      right: 0;
      top: 0;
      width: 400px;
      height: 100vh;
      background: var(--fintech-surface);
      box-shadow: -4px 0 24px rgba(0,0,0,0.1);
      z-index: 1000;
      animation: slideIn 0.3s ease;
      box-sizing: border-box;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    .panel-fixed-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 24px 24px 16px 24px;
      background: var(--fintech-surface);
      z-index: 1;
    }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .panel-header h3 { margin: 0; font-size: 20px; }
    .panel-subtitle { color: var(--fintech-text-secondary); font-size: 14px; margin: 0; }

    .panel-scrollable-content {
      position: absolute;
      top: 110px;
      bottom: 160px;
      left: 0;
      right: 0;
      overflow-y: auto;
      padding: 0 24px;
    }

    .panel-fixed-footer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 16px 24px 24px 24px;
      border-top: 1px solid var(--fintech-border);
      background: var(--fintech-surface);
      z-index: 1;
    }
    .panel-fixed-footer h4 { font-size: 14px; margin: 0 0 12px; color: var(--fintech-text-secondary); }

    .rules-list { display: flex; flex-direction: column; gap: 12px; }
    .rule-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: var(--fintech-bg);
      border-radius: 12px;
    }
    .rule-info { display: flex; align-items: center; gap: 12px; }
    .rule-icon { color: var(--fintech-text-secondary); }
    .rule-details { display: flex; flex-direction: column; }
    .rule-name { font-size: 14px; font-weight: 500; }
    .rule-value { font-size: 13px; color: var(--fintech-text-secondary); }
    .rule-actions { display: flex; align-items: center; gap: 8px; }
    .rule-status {
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .rule-status.active { background: #e8f5e9; color: #4caf50; }
    .rule-status.inactive { background: #fff3e0; color: #ff9800; }

    .no-rules {
      text-align: center;
      padding: 32px;
      background: var(--fintech-bg);
      border-radius: 12px;
    }
    .no-rules mat-icon { color: var(--fintech-text-secondary); margin-bottom: 8px; }
    .no-rules p { margin: 0; color: var(--fintech-text-secondary); }

    .full-width { width: 100%; margin-bottom: 12px; }
    .rule-form-row { display: flex; gap: 8px; }
    .rule-form-row input { flex: 1; }
    .rule-form-row button { min-width: 80px; padding: 0 16px !important; }

    .fintech-input {
      padding: 12px 14px;
      border: 1px solid var(--fintech-border);
      border-radius: 8px;
      font-size: 14px;
      background: var(--fintech-surface);
    }
    .fintech-input:focus { outline: none; border-color: var(--fintech-primary); }

    .reveal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .reveal-content {
      background: var(--fintech-surface);
      padding: 32px 48px;
      border-radius: 16px;
      text-align: center;
    }
    .reveal-content mat-spinner { margin: 0 auto 16px; }
    .reveal-content p { margin: 0; color: var(--fintech-text-secondary); }

    ::ng-deep .danger-item { color: #f44336 !important; }
    ::ng-deep .danger-item mat-icon { color: #f44336 !important; }

    .rule-item.mcc-rule { flex-direction: column; align-items: flex-start; }
    .rule-item.mcc-rule .rule-info { width: 100%; }
    .rule-item.mcc-rule .rule-actions { 
      width: 100%; 
      justify-content: flex-end; 
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--fintech-border);
    }

    .mcc-list { 
      display: flex; 
      flex-wrap: wrap; 
      gap: 6px; 
      margin-top: 8px; 
    }
    .mcc-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: var(--fintech-surface);
      border: 1px solid var(--fintech-border);
      border-radius: 6px;
      font-size: 12px;
    }
    .mcc-tag .mcc-code {
      font-family: monospace;
      font-weight: 600;
      background: var(--fintech-primary);
      color: white;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 11px;
    }
    .mcc-tag .mcc-label { color: var(--fintech-text-secondary); }

    .mcc-form-section { margin-top: 12px; }
    .mcc-search-container { position: relative; margin-bottom: 12px; }
    .mcc-search-container .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--fintech-text-secondary);
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .mcc-search { padding-left: 40px !important; }

    .mcc-option { display: flex; align-items: center; gap: 10px; }
    .mcc-option .mcc-code { 
      font-family: monospace; 
      font-weight: 600; 
      background: var(--fintech-bg); 
      padding: 2px 6px; 
      border-radius: 4px;
      font-size: 12px;
    }
    .mcc-option .mcc-label { font-size: 13px; }

    .selected-mccs-panel { 
      display: flex; 
      flex-wrap: wrap; 
      gap: 6px; 
      margin-bottom: 12px;
      max-height: 120px;
      overflow-y: auto;
    }
    .mcc-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--fintech-bg);
      border-radius: 6px;
      border: 1px solid var(--fintech-border);
    }
    .chip-code { 
      font-family: monospace; 
      font-weight: 600; 
      font-size: 11px;
      background: var(--fintech-primary);
      color: white;
      padding: 2px 5px;
      border-radius: 3px;
    }
    .chip-label { font-size: 12px; color: var(--fintech-text); }
    .chip-remove {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      color: var(--fintech-text-secondary);
    }
    .chip-remove:hover { color: #f44336; }
    .chip-remove mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .mcc-add-btn { margin-top: 8px; }

    .search-bar { margin-bottom: 24px; }
    .search-container {
      position: relative;
      max-width: 400px;
    }
    .search-container .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--fintech-text-secondary);
      font-size: 20px;
      width: 20px;
      height: 20px;
      z-index: 1;
    }
    .search-input {
      padding-left: 44px !important;
      padding-right: 40px !important;
      width: 100%;
      border-radius: 24px !important;
    }
    .search-clear {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--fintech-text-secondary);
      display: flex;
      align-items: center;
      padding: 4px;
    }
    .search-clear:hover { color: var(--fintech-text); }
    .search-clear mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .search-suggestion {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .suggestion-name { font-weight: 500; }
    .suggestion-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--fintech-text-secondary);
    }
    .suggestion-brand {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .suggestion-brand.visa { background: #1a1f71; color: white; }
    .suggestion-brand.mc { background: #eb001b; color: white; }
    .suggestion-status {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .suggestion-status.active { background: #e8f5e9; color: #4caf50; }
    .suggestion-status.suspended { background: #fff3e0; color: #ff9800; }

    .cards-section { margin-bottom: 32px; }
    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .section-title h2 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      color: var(--fintech-text);
    }
    .card-count {
      font-size: 12px;
      font-weight: 600;
      background: var(--fintech-bg);
      color: var(--fintech-text-secondary);
      padding: 2px 10px;
      border-radius: 12px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .status-dot.active { background: #4caf50; }
    .status-dot.suspended { background: #ff9800; }
    .status-dot.closed { background: #9e9e9e; }

    .closed-section { margin-top: 16px; }
    .show-closed-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border: 1px dashed var(--fintech-border);
      border-radius: 12px;
      background: transparent;
      color: var(--fintech-text-secondary);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
      justify-content: center;
    }
    .show-closed-btn:hover { border-color: var(--fintech-primary); color: var(--fintech-primary); }
    .loading-state.small { padding: 24px; }
    .loading-state.small p { font-size: 13px; }
    .no-closed {
      text-align: center;
      color: var(--fintech-text-secondary);
      font-size: 14px;
      padding: 16px;
    }

    .mcc-code.risky { background: #ff5722; }
    .mcc-chip.risky { 
      border-color: #ff5722; 
      background: #fff3e0;
    }
    .chip-code.risky { background: #ff5722; }
    .risky-badge {
      font-size: 10px;
      padding: 2px 5px;
      background: #ff5722;
      color: white;
      border-radius: 4px;
      font-weight: 600;
      margin-left: auto;
    }
    .risky-indicator {
      color: #ff5722;
      font-size: 12px;
    }
  `]
})
export class CardListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(MyPlatformService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user?: User;
  activeCards: CardResponse[] = [];
  suspendedCards: CardResponse[] = [];
  closedCards: CardResponse[] = [];
  closedCardsLoaded = false;
  filteredActiveCards: CardResponse[] = [];
  filteredSuspendedCards: CardResponse[] = [];
  searchSuggestions: CardResponse[] = [];
  searchControl = new FormControl('');
  selectedCard?: CardResponse;
  isLoadingActive = true;
  isLoadingClosed = false;
  isRevealing = false;
  isAddingRule = false;
  showRulesPanel = false;

  revealedCardId?: string;
  revealedData?: { pan: string; cvc: string; expiryMonth: string; expiryYear: string };

  allMccs = MCC_CODES;
  selectedMccsForRule: { code: string; label: string; risky?: boolean }[] = [];
  filteredMccs: { code: string; label: string; risky?: boolean }[] = [];
  mccSearchControl = new FormControl('');

  ruleForm = this.fb.group({
    type: ['maxAmountPerTransaction', Validators.required],
    value: [null as number | null, [Validators.required, Validators.min(1)]]
  });

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
        this.loadActiveAndSuspended();
      }
    });

    this.searchControl.valueChanges.subscribe(value => {
      this.filterCards(typeof value === 'string' ? value : '');
    });
  }

  loadUser() {
    this.service.getUserById(Number(this.userId)).subscribe({
      next: (user) => {
        this.user = user;
        this.cdr.detectChanges();
      }
    });
  }

  loadActiveAndSuspended() {
    this.isLoadingActive = true;
    let loaded = 0;
    const onLoaded = () => {
      loaded++;
      if (loaded >= 2) {
        this.isLoadingActive = false;
        this.filterCards('');
        this.cdr.detectChanges();
      }
    };

    this.service.getCards(Number(this.userId), 'active').subscribe({
      next: (cards) => {
        this.activeCards = cards;
        this.filteredActiveCards = cards;
        this.cdr.detectChanges();
        onLoaded();
      },
      error: () => {
        this.snack.open('Failed to load active cards', 'Close', { duration: 3000 });
        onLoaded();
      }
    });

    this.service.getCards(Number(this.userId), 'suspended').subscribe({
      next: (cards) => {
        this.suspendedCards = cards;
        this.filteredSuspendedCards = cards;
        this.cdr.detectChanges();
        onLoaded();
      },
      error: () => {
        this.snack.open('Failed to load suspended cards', 'Close', { duration: 3000 });
        onLoaded();
      }
    });
  }

  loadClosedCards() {
    this.isLoadingClosed = true;
    this.cdr.detectChanges();
    this.service.getCards(Number(this.userId), 'closed').subscribe({
      next: (cards) => {
        this.closedCards = cards;
        this.closedCardsLoaded = true;
        this.isLoadingClosed = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingClosed = false;
        this.closedCardsLoaded = true;
        this.snack.open('Failed to load closed cards', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  filterCards(searchTerm: string) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredActiveCards = this.activeCards;
      this.filteredSuspendedCards = this.suspendedCards;
      this.searchSuggestions = [];
      return;
    }
    const allCards = [...this.activeCards, ...this.suspendedCards];
    this.searchSuggestions = allCards.filter(c =>
      c.cardholderName?.toLowerCase().includes(term)
    );
    this.filteredActiveCards = this.activeCards.filter(c =>
      c.cardholderName?.toLowerCase().includes(term)
    );
    this.filteredSuspendedCards = this.suspendedCards.filter(c =>
      c.cardholderName?.toLowerCase().includes(term)
    );
  }

  onSearchSelect(event: any) {
    const card: CardResponse = event.option.value;
    this.searchControl.setValue(card.cardholderName, { emitEvent: false });
    this.filteredActiveCards = this.activeCards.filter(c => c.paymentInstrumentId === card.paymentInstrumentId);
    this.filteredSuspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId === card.paymentInstrumentId);
    this.searchSuggestions = [];
    this.selectCard(card);
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchControl.setValue('');
    this.filteredActiveCards = this.activeCards;
    this.filteredSuspendedCards = this.suspendedCards;
    this.searchSuggestions = [];
    this.cdr.detectChanges();
  }

  navigateToCreate() {
    this.router.navigate(['/', this.userId, 'card-create']);
  }

  selectCard(card: CardResponse) {
    if (this.selectedCard?.paymentInstrumentId === card.paymentInstrumentId) {
      this.selectedCard = undefined;
      this.hideRevealedData();
    } else {
      this.selectedCard = card;
      this.hideRevealedData();
    }
  }

  async revealCardDetails(card: CardResponse) {
    if (this.revealedCardId === card.paymentInstrumentId) {
      this.hideRevealedData();
      return;
    }

    this.isRevealing = true;
    this.cdr.detectChanges();

    try {
      // All crypto is now handled server-side
      const { cardData } = await this.service.revealCardData(card.paymentInstrumentId).toPromise() as { cardData: string };

      // Parse the decrypted JSON data
      const parsedData = JSON.parse(cardData);
      console.log('Revealed card data:', parsedData);

      // Map Adyen response fields to our expected format
      this.revealedCardId = card.paymentInstrumentId;
      this.revealedData = {
        pan: parsedData.pan,
        cvc: parsedData.cvc,
        expiryMonth: parsedData.expiration?.month,
        expiryYear: parsedData.expiration?.year
      };
      this.isRevealing = false;
      this.cdr.detectChanges();

      // Auto-hide after 30 seconds
      setTimeout(() => {
        if (this.revealedCardId === card.paymentInstrumentId) {
          this.hideRevealedData();
        }
      }, 30000);

    } catch (error) {
      console.error('Failed to reveal card details:', error);
      this.isRevealing = false;
      this.snack.open('Failed to reveal card details', 'Close', { duration: 3000 });
      this.cdr.detectChanges();
    }
  }

  hideRevealedData() {
    this.revealedCardId = undefined;
    this.revealedData = undefined;
    this.cdr.detectChanges();
  }

  copyCardNumber(card: CardResponse) {
    if (this.revealedData?.pan) {
      navigator.clipboard.writeText(this.revealedData.pan);
      this.snack.open('Card number copied', 'Close', { duration: 2000 });
    }
  }

  suspendCard(card: CardResponse) {
    this.service.updateCardStatus(card.paymentInstrumentId, 'suspended').subscribe({
      next: () => {
        this.activeCards = this.activeCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
        card.status = 'suspended';
        this.suspendedCards.push(card);
        this.filterCards(this.searchControl.value || '');
        this.snack.open('Card suspended', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to suspend card', 'Close', { duration: 3000 });
      }
    });
  }

  activateCard(card: CardResponse) {
    this.service.updateCardStatus(card.paymentInstrumentId, 'active').subscribe({
      next: () => {
        this.suspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
        card.status = 'active';
        this.activeCards.push(card);
        this.filterCards(this.searchControl.value || '');
        this.snack.open('Card reactivated', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to reactivate card', 'Close', { duration: 3000 });
      }
    });
  }

  closeCard(card: CardResponse) {
    if (confirm('Are you sure you want to close this card? This action cannot be undone.')) {
      this.service.updateCardStatus(card.paymentInstrumentId, 'closed').subscribe({
        next: () => {
          this.activeCards = this.activeCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
          this.suspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
          card.status = 'closed';
          if (this.closedCardsLoaded) {
            this.closedCards.push(card);
          }
          this.filterCards(this.searchControl.value || '');
          this.snack.open('Card closed', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        },
        error: () => {
          this.snack.open('Failed to close card', 'Close', { duration: 3000 });
        }
      });
    }
  }

  openRulesPanel(card: CardResponse) {
    this.selectedCard = card;
    this.showRulesPanel = true;
    this.cdr.detectChanges();
  }

  closeRulesPanel() {
    this.showRulesPanel = false;
    this.cdr.detectChanges();
  }

  getRuleIcon(type: string): string {
    switch (type) {
      case 'maxTransactions': return 'pin';
      case 'maxAmountPerTransaction': return 'payments';
      case 'maxTotalAmount': return 'account_balance_wallet';
      case 'blockedMccs': return 'block';
      default: return 'rule';
    }
  }

  getRuleName(type: string): string {
    switch (type) {
      case 'maxTransactions': return 'Transaction limit';
      case 'maxAmountPerTransaction': return 'Max amount per transaction';
      case 'maxTotalAmount': return 'Total spending limit';
      case 'blockedMccs': return 'Blocked merchant categories';
      default: return type;
    }
  }

  getMccLabel(code: string): string {
    const mcc = this.allMccs.find(m => m.code === code);
    return mcc ? mcc.label : code;
  }

  addRule() {
    if (!this.selectedCard) return;

    const type = this.ruleForm.value.type!;

    // Handle MCC rule separately
    if (type === 'blockedMccs') {
      if (this.selectedMccsForRule.length === 0) return;

      this.isAddingRule = true;
      const request: AddTransactionRuleRequest = {
        paymentInstrumentId: this.selectedCard.paymentInstrumentId,
        type: 'blockedMccs',
        blockedMccs: this.selectedMccsForRule.map(m => m.code)
      };

      this.service.addTransactionRule(request).subscribe({
        next: () => {
          this.snack.open('MCC block rule added successfully', 'Close', { duration: 3000 });
          this.selectedMccsForRule = [];
          this.mccSearchControl.setValue('');
          this.isAddingRule = false;
          this.refreshCardRules();
        },
        error: () => {
          this.isAddingRule = false;
          this.snack.open('Failed to add rule', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        }
      });
      return;
    }

    // Handle other rules
    if (this.ruleForm.invalid) return;

    this.isAddingRule = true;
    const rawValue = this.ruleForm.value.value!;
    // Convert to minor units for amount-based rules (multiply by 100)
    const value = type === 'maxTransactions' ? rawValue : Math.round(rawValue * 100);

    const request: AddTransactionRuleRequest = {
      paymentInstrumentId: this.selectedCard.paymentInstrumentId,
      type: type,
      value: value,
      currencyCode: this.user?.currencyCode
    };

    this.service.addTransactionRule(request).subscribe({
      next: () => {
        this.snack.open('Rule added successfully', 'Close', { duration: 3000 });
        this.ruleForm.reset({ type: 'maxAmountPerTransaction' });
        this.isAddingRule = false;
        this.refreshCardRules();
      },
      error: () => {
        this.isAddingRule = false;
        this.snack.open('Failed to add rule', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  toggleRuleStatus(rule: TransactionRuleResponse) {
    const newStatus = rule.status === 'active' ? 'inactive' : 'active';
    this.service.updateTransactionRule(rule.id, newStatus).subscribe({
      next: () => {
        rule.status = newStatus;
        this.snack.open('Rule updated', 'Close', { duration: 2000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to update rule', 'Close', { duration: 3000 });
      }
    });
  }

  deleteRule(rule: TransactionRuleResponse) {
    if (confirm('Delete this rule?')) {
      this.service.deleteTransactionRule(rule.id).subscribe({
        next: () => {
          this.snack.open('Rule deleted', 'Close', { duration: 2000 });
          this.refreshCardRules();
        },
        error: () => {
          this.snack.open('Failed to delete rule', 'Close', { duration: 3000 });
        }
      });
    }
  }

  refreshCardRules() {
    if (!this.selectedCard) return;

    this.service.getCardDetails(this.selectedCard.paymentInstrumentId).subscribe({
      next: (card) => {
        this.selectedCard = card;
        const activeIndex = this.activeCards.findIndex(c => c.paymentInstrumentId === card.paymentInstrumentId);
        if (activeIndex >= 0) this.activeCards[activeIndex] = card;
        const suspIndex = this.suspendedCards.findIndex(c => c.paymentInstrumentId === card.paymentInstrumentId);
        if (suspIndex >= 0) this.suspendedCards[suspIndex] = card;
        this.filterCards(this.searchControl.value || '');
        this.cdr.detectChanges();
      }
    });
  }

  onRuleTypeChange() {
    if (this.ruleForm.value.type === 'blockedMccs') {
      this.filteredMccs = this.allMccs;
      this.mccSearchControl.valueChanges.subscribe(value => {
        this.filterMccsForRule(value || '');
      });
    }
    this.selectedMccsForRule = [];
  }

  filterMccsForRule(searchTerm: string) {
    if (!searchTerm) {
      this.filteredMccs = this.allMccs.filter(
        mcc => !this.selectedMccsForRule.some(s => s.code === mcc.code)
      );
      return;
    }
    const term = searchTerm.toLowerCase();
    this.filteredMccs = this.allMccs.filter(
      mcc => !this.selectedMccsForRule.some(s => s.code === mcc.code) &&
        (mcc.code.toLowerCase().includes(term) || mcc.label.toLowerCase().includes(term))
    );
  }

  addMccToRule(event: any) {
    const mcc = event.option.value;
    if (!this.selectedMccsForRule.some(s => s.code === mcc.code)) {
      this.selectedMccsForRule.push(mcc);
    }
    this.mccSearchControl.setValue('');
    this.filterMccsForRule('');
    this.cdr.detectChanges();
  }

  removeMccFromRule(mcc: { code: string; label: string; risky?: boolean }) {
    this.selectedMccsForRule = this.selectedMccsForRule.filter(s => s.code !== mcc.code);
    this.filterMccsForRule(this.mccSearchControl.value || '');
    this.cdr.detectChanges();
  }
}
