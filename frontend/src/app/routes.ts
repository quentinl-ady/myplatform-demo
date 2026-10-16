import { Routes } from '@angular/router';
import {LayoutComponent} from "./layout/layout.component";

const routeConfig: Routes = [
  {
    path: '',
    loadComponent: () => import('./main/main.component').then(m => m.MainComponent),
    title: 'Log in'
  },
  {
    path: 'result/:status',
    loadComponent: () => import('./result/paymentresult.component').then(m => m.PaymentResultComponent),
    title: 'Payment result'
  },
  {
    path: 'login',
    pathMatch: 'full',
    redirectTo: ''
  },
  {
    path: ':id',
    component: LayoutComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
        title: 'Onboarding'
      },
      {
        path: 'transactions',
        loadComponent: () => import('./payment/payment.component').then(m => m.PaymentComponent),
        title: 'Transactions'
      },
      {
        path: 'report',
        loadComponent: () => import('./report/report.component').then(m => m.ReportComponent),
        title: 'Reports'
      },
      {
        path: 'cash-management',
        loadComponent: () => import('./cash-management/cash-management.component').then(m => m.CashManagementComponent),
        title: 'Cash management'
      },
      {
        path: 'dispute',
        loadComponent: () => import('./dispute/dispute.component').then(m => m.DisputeComponent),
        title: 'Disputes'
      },
      {
        path: 'businessloans',
        loadComponent: () => import('./business-loans/business-loans.component').then(m => m.BusinessLoansComponent),
        title: 'Loans'
      },
      {
        path: 'store',
        loadComponent: () => import('./store/store.component').then(m => m.StoreComponent),
        title: 'Stores'
      },
      {
        path: 'checkout',
        loadComponent: () => import('./checkout/checkout.component').then(m => m.CheckoutComponent),
        title: 'Checkout'
      },
      {
        path: 'captures',
        loadComponent: () => import('./captures/captures.component').then(m => m.CapturesComponent),
        title: 'Captures'
      },
      {
         path: 'paybylink',
         loadComponent: () => import('./paybylink/paybylink.component').then(m => m.PayByLinkComponent),
         title: 'Pay by Link'
      },
      {
        path: 'business-account-device',
        loadComponent: () => import('./device/device.component').then(m => m.DeviceComponent),
        title: 'Trusted devices'
      },
      {
        path: 'business-account',
        loadComponent: () => import('./transfer/transfer.component').then(m => m.TransferComponent),
        title: 'Business account'
      },
      {
        path: 'banktransfer',
        loadComponent: () => import('./banktransfer/banktransfer.component').then(m => m.BankTransferComponent),
        title: 'Bank transfers'
      },
      {
        path: 'batch-transfer',
        loadComponent: () => import('./batch-transfer/batch-transfer.component').then(m => m.BatchTransferComponent),
        title: 'Batch transfers'
      },
      {
        path: 'pos',
        loadComponent: () => import('./pos/pos.component').then(m => m.PosComponent),
        title: 'Point of sale'
      },
      {
        path: 'cards',
        loadComponent: () => import('./card-list/card-list.component').then(m => m.CardListComponent),
        title: 'My cards'
      },
      {
        path: 'card-create',
        loadComponent: () => import('./card-create/card-create.component').then(m => m.CardCreateComponent),
        title: 'Create card'
      },
      {
        path: 'card-transactions',
        loadComponent: () => import('./card-transactions/card-transactions.component').then(m => m.CardTransactionsComponent),
        title: 'Card transactions'
      },
      {
        path: 'issuing-checkout',
        loadComponent: () => import('./issuing-checkout/issuing-checkout.component').then(m => m.IssuingCheckoutComponent),
        title: 'Test issued cards'
      },
      {
        path: 'relayed-auth',
        loadComponent: () => import('./relayed-auth/relayed-auth.component').then(m => m.RelayedAuthComponent),
        title: 'Relayed authorisation'
      },
      {
        path: 'notifications',
        loadComponent: () => import('./webhooks/webhooks.component').then(m => m.WebhooksComponent),
        title: 'Notifications'
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/'
  }

];

export default routeConfig;
