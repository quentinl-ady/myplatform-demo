import {Component} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import { AdyenPlatformExperience, TransactionsOverview } from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";

@Component({
    selector: 'app-payment',
    standalone: true,
    template: `
    <div id="adyen-component" class="main-container">
      <div id="transactions-overview-container"></div>
    </div>
  `,
    imports: [CommonModule, MaterialModule]
})
export class PaymentComponent {

    userId = '';

    constructor(private route: ActivatedRoute,
                private sessionService: SessionService,
                private matSnackBar: MatSnackBar) {
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.initAdyenComponents();
            }
        });
    }

    private async initAdyenComponents() {
        const core = await AdyenPlatformExperience({
            onSessionCreate: async () => {
                const sessionToken = await this.sessionService.getPaymentInformation(this.userId).toPromise();
                if (!sessionToken) {
                    throw new Error('Impossible to get payment information');
                }
                return {
                    token: sessionToken.token,
                    id: sessionToken.id
                };
            }
        });
        const transactionsOverview = new TransactionsOverview({core});
        transactionsOverview.mount('#transactions-overview-container');
    }


}
