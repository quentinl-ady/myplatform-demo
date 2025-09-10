import {Component, ElementRef, ViewChild} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {CommonModule} from "@angular/common";
import { AdyenPlatformExperience, TransactionsOverview, TransactionDetails } from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {MyPlatformService} from "../my-platform-service";

@Component({
    selector: 'app-payment',
    standalone: true,
    template: `
    <div id="adyen-component" class="main-container">
      <div id="transactions-overview-container"></div>
    </div>
  `,
    imports: [MatSnackBarModule, CommonModule]
})
export class PaymentComponent {
    @ViewChild('overviewContainer', { static: true }) overviewContainer!: ElementRef;
    @ViewChild('detailsContainer', { static: true }) detailsContainer!: ElementRef;

    userId = '';

    constructor(private route: ActivatedRoute,
                private authService: MyPlatformService,
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
                const paymentInfo = await this.authService.getPaymentInformation(this.userId).toPromise();
                if (!paymentInfo) {
                    throw new Error('Impossible to get payment information');
                }
                return {
                    token: paymentInfo.token,
                    id: paymentInfo.id
                };
            }
        });
        const transactionsOverview = new TransactionsOverview({core});
        transactionsOverview.mount('#transactions-overview-container');
    }


}
