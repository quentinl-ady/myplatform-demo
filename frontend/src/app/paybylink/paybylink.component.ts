import {Component} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import {
    AdyenPlatformExperience,
    PaymentLinksOverview
} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";

@Component({
    selector: 'app-paybylink',
    standalone: true,
    imports: [CommonModule, MaterialModule],
    template: `
    <div id="adyen-component" class="main-container">
          <div id="payment-links-overview-container"></div>
        </div>
  `
})
export class PayByLinkComponent {

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
                const sessionToken = await this.sessionService.getPayByLinkInformation(this.userId).toPromise();
                if (!sessionToken) {
                    throw new Error('Impossible to get paybylink information');
                }
                return {
                    token: sessionToken.token,
                    id: sessionToken.id
                };
            }
        });
        const paymentLinksOverview = new PaymentLinksOverview({core});
        paymentLinksOverview.mount('#payment-links-overview-container');
    }

}
