// import {CommonModule} from "@angular/common";
// import {MaterialModule} from "../material.module";
// import {ReactiveFormsModule} from "@angular/forms";
// import {MatSnackBar, MatSnackBarModule} from "@angular/material/snack-bar";
// import {MatButtonModule} from "@angular/material/button";
// import {MatCardModule} from "@angular/material/card";
// import {MatProgressSpinnerModule} from "@angular/material/progress-spinner";
// import {MatFormFieldModule} from "@angular/material/form-field";
// import {MatSelectModule} from "@angular/material/select";
// import {MatInputModule} from "@angular/material/input";
// import {Component, inject, OnInit} from "@angular/core";
// import {MyPlatformService} from "../my-platform-service";
// import {ActivatedRoute} from "@angular/router";
//
// @Component({
//     selector: 'app-checkout-redirect',
//     standalone: true,
//     imports: [
//         CommonModule,
//         MaterialModule,
//         ReactiveFormsModule,
//         MatSnackBarModule,
//         MatButtonModule,
//         MatCardModule,
//         MatProgressSpinnerModule,
//         MatFormFieldModule,
//         MatSelectModule,
//         MatInputModule
//     ],
//     template: `<p>Processing payment...</p>`
// })
// export class CheckoutRedirectComponent implements OnInit {
//     private authService = inject(MyPlatformService);
//     private route = inject(ActivatedRoute);
//     private matSnackBar = inject(MatSnackBar);
//
//     ngOnInit() {
//         // Adyen redirection result
//         const queryParams = this.route.snapshot.queryParams;
//         const redirectResult = queryParams['redirectResult'] || queryParams['payload'];
//
//         if (!redirectResult) {
//             this.matSnackBar.open('No redirect result found', 'Close', { duration: 3000 });
//             return;
//         }
//
//         // Call backend to confirm payment
//         this.authService.confirmRedirect(redirectResult).subscribe({
//             next: (res) => {
//                 this.matSnackBar.open('Payment confirmed successfully', 'Close', { duration: 3000 });
//                 console.log(res);
//             },
//             error: (err) => {
//                 this.matSnackBar.open('Payment confirmation failed', 'Close', { duration: 3000 });
//                 console.error(err);
//             }
//         });
//     }
// }
