import { Routes } from '@angular/router';
import {LoginComponent} from "./login/login.component";
import {MainComponent} from "./main/main.component";
import {DashboardComponent} from "./dashboard/dashboard.component";
import {LayoutComponent} from "./layout/layout.component";
import {PaymentComponent} from "./payment/payment.component";

// const routeConfig: Routes = [
//   {
//     path: '',
//     component: MainComponent,
//     title: 'Homepage'
//   },
//   {
//     path: 'login',
//     component: LoginComponent,
//     title: 'Login'
//   },
//   { path: ':id/dashboard',
//     component: DashboardComponent,
//     title: 'Dashboard'
//   }
//
// ];



const routeConfig: Routes = [
  {
    path: '',
    component: MainComponent,
    title: 'Homepage'
  },
  {
    path: 'login',
    component: LoginComponent,
    title: 'Login'
  },
  {
    path: ':id',
    component: LayoutComponent,
    children: [
      {
        path: 'dashboard',
        component: DashboardComponent,
        title: 'Dashboard'
      },
      {
        path: 'payment',
        component: PaymentComponent,
        title: 'Payment'
      }
    ]
  }

];

export default routeConfig;
