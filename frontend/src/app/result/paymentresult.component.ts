import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

@Component({
    selector: 'app-payment-result',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="result-container">
      <h2>Payment Status</h2>
      <p *ngIf="reason === 'Authorised'">✅ Payment successful!</p>
      <p *ngIf="reason === 'Pending' || reason === 'Received'">⏳ Payment pending...</p>
      <p *ngIf="reason === 'Refused'">❌ Payment failed.</p>
      <p *ngIf="reason !== 'Authorised' && reason !== 'Pending' && reason !== 'Received' && reason !== 'Refused'">
        ⚠️ Unknown status: {{ reason }}
      </p>
    </div>
  `,
    styles: [`
    .result-container { padding: 2rem; text-align: center; font-size: 1.2rem; }
  `]
})
export class PaymentResultComponent implements OnInit {
    reason: string = '';
    private route = inject(ActivatedRoute);

    ngOnInit(): void {
        this.route.queryParams.subscribe(params => {
            this.reason = params['reason'] || 'Unknown';
        });
    }
}
