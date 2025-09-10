import {Component, ElementRef, ViewChild} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {CommonModule} from "@angular/common";
import {AdyenPlatformExperience, PayoutsOverview, ReportsOverview} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {MyPlatformService} from "../my-platform-service";

@Component({
    selector: 'app-payout',
    standalone: true,
    template: `
    <div id="adyen-component" class="main-container">
      <div id="payout-overview-container"></div>
    </div>
  `,
    imports: [MatSnackBarModule, CommonModule]
})
export class PayoutComponent {

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
                const sessionToken = await this.authService.getPayoutInformation(this.userId).toPromise();
                if (!sessionToken) {
                    throw new Error('Impossible to get payout information');
                }
                return {
                    token: sessionToken.token,
                    id: sessionToken.id
                };
            }
        });
        const payoutsOverview = new PayoutsOverview({core});
        payoutsOverview.mount('#payout-overview-container');
    }


}
