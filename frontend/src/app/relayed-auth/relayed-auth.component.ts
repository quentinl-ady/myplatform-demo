import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { IssuingService } from '../services';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-relayed-auth',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule
  ],
  templateUrl: './relayed-auth.component.html',
  styleUrl: './relayed-auth.component.css'
})
export class RelayedAuthComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private issuingService = inject(IssuingService);
  private snack = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  approvalPercentage = 100;
  savedPercentage = 100;
  isLoading = true;
  isSaving = false;
  webhookUrl = '';

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
    this.issuingService.getRelayedAuthConfig(this.userId).subscribe({
      next: (config) => {
        this.approvalPercentage = config.approvalPercentage;
        this.savedPercentage = config.approvalPercentage;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.snack.open('Failed to load configuration', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  save() {
    this.isSaving = true;
    this.issuingService.updateRelayedAuthConfig(this.userId, this.approvalPercentage).subscribe({
      next: (config) => {
        this.savedPercentage = config.approvalPercentage;
        this.isSaving = false;
        this.snack.open('Approval percentage updated', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSaving = false;
        this.snack.open('Failed to update configuration', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  get hasChanges(): boolean {
    return this.approvalPercentage !== this.savedPercentage;
  }

  getStatusLabel(): string {
    if (this.approvalPercentage === 100) return 'Approve all';
    if (this.approvalPercentage === 0) return 'Refuse all';
    return `${this.approvalPercentage}% approval rate`;
  }

  getStatusColor(): string {
    if (this.approvalPercentage >= 80) return '#4caf50';
    if (this.approvalPercentage >= 50) return '#ff9800';
    return '#e53935';
  }

  copyWebhookUrl() {
    navigator.clipboard.writeText(this.webhookUrl);
    this.snack.open('Webhook URL copied', 'Close', { duration: 2000 });
  }
}
