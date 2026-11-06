import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../material.module';
import { IssuingService } from '../services';
import { environment } from '../../environments/environment';
import { InlineAlertComponent, NotifyService, httpErrorMessage } from '../shared';

@Component({
  selector: 'app-relayed-auth',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule,
    InlineAlertComponent
  ],
  templateUrl: './relayed-auth.component.html',
  styleUrl: './relayed-auth.component.css'
})
export class RelayedAuthComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private issuingService = inject(IssuingService);
  private notify = inject(NotifyService);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  approvalPercentage = 100;
  savedPercentage = 100;
  isLoading = true;
  loadError: string | null = null;
  isSaving = false;
  saveError: string | null = null;
  copyFailed = false;
  webhookUrl = '';
  readonly presets = [0, 25, 50, 75, 100];

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.webhookUrl = `${environment.apiBaseUrl}/api/webhooks/relayed-auth`;
        this.loadConfig();
      }
    });
  }

  loadConfig() {
    this.isLoading = true;
    this.loadError = null;
    this.issuingService.getRelayedAuthConfig(this.userId).subscribe({
      next: (config) => {
        this.approvalPercentage = config.approvalPercentage;
        this.savedPercentage = config.approvalPercentage;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        this.loadError = httpErrorMessage(err, 'Try again in a moment.');
        this.cdr.detectChanges();
      }
    });
  }

  save() {
    if (this.isSaving || !this.hasChanges) return;
    this.isSaving = true;
    this.saveError = null;
    this.issuingService.updateRelayedAuthConfig(this.userId, this.approvalPercentage).subscribe({
      next: (config) => {
        this.savedPercentage = config.approvalPercentage;
        this.isSaving = false;
        this.notify.success(`Saved: ${this.describe(config.approvalPercentage)}.`);
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSaving = false;
        this.saveError = httpErrorMessage(err, 'Unable to save the approval percentage. Try again.');
        this.cdr.detectChanges();
      }
    });
  }

  get hasChanges(): boolean {
    return this.approvalPercentage !== this.savedPercentage;
  }

  resetChanges() {
    this.approvalPercentage = this.savedPercentage;
    this.saveError = null;
  }

  getStatusLabel(): string {
    if (this.approvalPercentage === 100) return 'Approve all';
    if (this.approvalPercentage === 0) return 'Refuse all';
    return 'Approve some';
  }

  /** Colour is a supplement; the label above always carries the same meaning. */
  getStatusClass(): 'high' | 'medium' | 'low' {
    if (this.approvalPercentage >= 80) return 'high';
    if (this.approvalPercentage >= 50) return 'medium';
    return 'low';
  }

  describe(pct: number): string {
    if (pct === 100) return 'all card payments are approved';
    if (pct === 0) return 'all card payments are refused';
    return `about ${pct} out of 100 card payments are approved`;
  }

  formatPercent(value: number): string {
    return `${value}%`;
  }

  async copyWebhookUrl() {
    this.copyFailed = false;
    try {
      await navigator.clipboard.writeText(this.webhookUrl);
      this.notify.success('Webhook URL copied.');
    } catch {
      this.copyFailed = true;
    }
    this.cdr.detectChanges();
  }
}
