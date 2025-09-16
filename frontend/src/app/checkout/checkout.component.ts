import {Component, ElementRef, ViewChild} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {CommonModule} from "@angular/common";
import {MyPlatformService} from "../my-platform-service";

@Component({
    selector: 'app-checkout',
    standalone: true,
    template: `
    <div id="adyen-component" class="main-container">
      <p> checkout todo </p>
    </div>
  `,
    imports: [MatSnackBarModule, CommonModule]
})
export class CheckoutComponent {

    userId = '';

    constructor(private route: ActivatedRoute,
                private authService: MyPlatformService,
                private matSnackBar: MatSnackBar) {
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {

            }
        });
    }


}
