<div align="center">

# MyPlatform Demo

**Full-stack demo of [Adyen for Platforms](https://docs.adyen.com/platforms/) — Payments · Banking · Issuing · Capital**

Angular 17 &nbsp;•&nbsp; Spring Boot 3.2 &nbsp;•&nbsp; SQLite &nbsp;•&nbsp; Adyen Java API Library 40

</div>

---

## Overview

MyPlatform Demo simulates a **marketplace / SaaS platform** that onboards sub-merchants, collects payments, issues virtual cards, opens bank accounts and performs bank transfers — all powered by Adyen APIs in TEST environment.

---

## Features

| Domain | Highlights |
|--------|-----------|
| **Onboarding & KYC** | Legal Entity creation (Individual / Organization / Sole Proprietorship) · Hosted Onboarding Page · Capability tracking · Automated KYC dev-tool (doc upload, ToS, PCI) · Business Lines |
| **Payments** | Store creation with split config · Payment method setup (Visa, MC, CB, Amex) · Checkout sessions with redirect · Tokenization (zero-auth) · Token payments (ContAuth) · Token deletion · Pay By Link · POS via Terminal API (Cloud) |
| **Banking** | Bank account provisioning (IBAN / Account Number) · Balance display · Transfers (Regular & Instant) with country-aware format detection, async validation, Confirmation of Payee, SCA via WebAuthn · Auto-sweep (cron) |
| **Issuing** | Virtual card creation (Visa / MC) · Lifecycle mgmt (active / suspended / closed) · Card data reveal (RSA/AES) · Transaction rules (max txns, max amount, total cap, MCC blocking) · Transaction history · **Test Issued Cards** checkout (Visa/MC only, dedicated issuing credentials) |
| **Capital** | Loan offers display & management via Adyen Capital component |
| **Payouts** | Sweep/payout config to external bank accounts · Regular & instant |
| **Platform Experience** | Transactions overview · Reports · Payouts · Disputes · Pay By Link · Capital |
| **Security** | SCA device registration & management via WebAuthn (`@adyen/bpscaweb`) |
| **Invoicing & accounting** | Invoices paid by Pay by Link (PDF with QR code) · Subscriptions charged with stored tokens (ContAuth) and Auto Rescue · Supplier bills paid in one SCA-approved batch or by single-use virtual card · Card expenses with receipts · Matched accounting journal, payout breakdown, CSV and CAMT.053 exports · Onboarding prefilled with the imported company record · Demo data. See [Invoicing & accounting](#invoicing--accounting) |

---

## Invoicing & accounting

With Adyen, a business runs the whole cycle in one system, from the invoice to the reconciled journal entry. The pages sit in the **Invoicing & accounting** section of the menu, and the dashboard links to them.

| Page | What it shows |
|------|---------------|
| **Invoices** | Customers and invoices, numbered per account (`INV-2026-0001`), with VAT per line. **Send** creates a payment link: the invoice number as reference, line items with VAT, and an expiry at the due date (70 days at most). The PDF carries the platform branding, a *Pay now* button and a QR code. The invoice turns *Paid* on the AUTHORISATION webhook, or when the page reads the payment link. |
| **Subscriptions** | Monthly or yearly plans. The first invoice is paid by a link that stores the payment method (`storePaymentMethodMode=enabled`, `recurringProcessingModel=Subscription`). **Run billing cycle now** charges the token with `shopperInteraction=ContAuth`. Each cycle creates its invoice. A refused cycle puts the subscription *Past due*; |
| **Bills** | Suppliers and their bills, with expense categories (62xx). Several bills are paid in one batch of transfers approved with a single SCA on *Batch transfers*, after a Verification of Payee check of each supplier. The transfer speeds offered are the routes Adyen calculates to the bank of each supplier (`transferRoutes/calculate`), within their amount limits. A bill can also be paid by a single-use virtual card (`maxTransactions = 1`, `maxTotalAmount` = the bill), charged on *Test issued cards*. Needs Bank or Issuing. |
| **Card transactions** | Each card spend gets a category, a VAT rate, a note and a receipt (image or PDF, 2 MB at most). A *Receipt missing* badge flags the others. |
| **Accounting** | Journal of the last 30 days by default, built from the Transfers API and matched with invoices, bills and card expenses, with a debit = credit check and the automatic matching rate. Each payout is broken down into the movements since the previous one. Exports: the journal as CSV, the account statements as CAMT.053 XML. |
| **Onboarding** | At sign-up, organizations and sole proprietorships can **Import company**: registered address, registration number, VAT number and phone, from the Adyen TEST data of `CountryKycData`. The legal entity is created with them, so the hosted onboarding only asks for the rest, and the Onboarding page shows a *Prefilled from your system* badge. |


### Webhooks

Send the standard webhooks and the balance platform transfer webhooks (`balancePlatform.transfer.updated`) to `POST /api/webhooks/adyen`. Without them, for example when running locally, invoices and bills read their status from Adyen (`GET /paymentLinks/{id}`, `GET /btl/v4/transfers/{id}`) when their page opens.

### Backend endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/customers/{userId}` | Customers |
| `/api/invoices/{userId}` | Invoices: send, void, PDF |
| `/api/subscriptions/{userId}` | Subscriptions: run a cycle, stop Auto Rescue, cancel |
| `/api/suppliers/{userId}` | Suppliers |
| `/api/bills/{userId}` | Bills: payee checks, transfer speeds, payment by transfer or by card |
| `/api/card-expenses/{userId}` | Card expenses and receipts |
| `/api/ledger/{userId}` | Journal and payouts; `/export` for the CSV |
| `/api/statements/{userId}/download-xml` | CAMT.053 account statement |
| `POST /api/demo-data/{userId}` | Demo data |
| `/api/auth/company-record?country=FR` | Company record imported at sign-up |

---

## Architecture

```
┌──────────────────────┐            ┌──────────────────────┐
│   Angular 17 SPA     │    HTTP    │   Spring Boot 3.2    │
│   localhost:4200      │◄──────────►   localhost:8080      │
│                      │            │                      │
│  Angular Material    │            │  REST Controllers    │
│  Adyen Web SDK 6     │            │  Adyen Java Lib 40   │
│  Platform Experience │            │  Spring Data JPA     │
│  KYC Components      │            │  SQLite              │
│  bpscaweb (SCA)      │            │  iText 8 (PDF)       │
│                      │            │  jose4j (JWT)        │
└──────────────────────┘            └──────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │   Adyen APIs (TEST)  │
                                    │                      │
                                    │  Legal Entity Mgmt   │
                                    │  Balance Platform    │
                                    │  Checkout            │
                                    │  Management          │
                                    │  Transfers           │
                                    │  Terminal (Cloud)    │
                                    │  Auth Sessions       │
                                    └──────────────────────┘
```

---

## Adyen API Keys & Required Roles

The application uses **4 separate API keys**, each mapped to a dedicated `Client` bean in `AdyenClientConfig.java`.

---

### `adyen.lemApiKey` — Legal Entity Management

| API | Endpoint | Method | Service | Role required |
|-----|----------|--------|---------|---------------|
| **Legal Entities** | `/legalEntities` | POST | `LegalEntityService`, `KYCService` | Manage legal entities |
| **Legal Entities** | `/legalEntities/{id}` | GET | `LegalEntityService`, `KYCService` | Manage legal entities |
| **Legal Entities** | `/legalEntities/{id}` | PATCH | `KYCService` | Manage legal entities |
| **Legal Entities** | `/legalEntities/{id}/businessLines` | GET | `LegalEntityService`, `StoreManagementService` | Manage legal entities |
| **Hosted Onboarding** | `/legalEntities/{id}/onboardingLinks` | POST | `LegalEntityService` | Manage hosted onboarding |
| **Business Lines** | `/businessLines` | POST | `LegalEntityService`, `BankingProvisioningService` | Manage business lines |
| **Documents** | `/documents` | POST | `KYCService` | Manage documents |
| **Terms of Service** | `/legalEntities/{id}/termsOfServiceDocument` | POST | `KYCService` | Manage terms of service |
| **Terms of Service** | `/legalEntities/{id}/termsOfService/{tosId}` | PATCH | `KYCService` | Manage terms of service |
| **PCI Questionnaires** | `/legalEntities/{id}/pciQuestionnaires/generatePciTemplates` | POST | `KYCService` | Manage PCI questionnaires |
| **PCI Questionnaires** | `/legalEntities/{id}/pciQuestionnaires/signPciTemplates` | POST | `KYCService` | Manage PCI questionnaires |
| **Transfer Instruments** | `/transferInstruments/{id}` | GET | `PayoutConfigurationService` | Manage transfer instruments |
| **Auth Sessions** | `authe/api/v1/sessions` | POST | `AdyenSessionService` (onboarding product) | Manage authentication sessions |

> **Roles to enable in Customer Area** (Settings > API credentials > Roles):
>
> | Customer Area role name | Used for |
> |---|---|
> | `Legal Entity Management API` | Legal entities CRUD, business lines, documents, ToS, PCI, hosted onboarding |
> | `Hosted Onboarding - Manage Onboarding Links` | HOP link generation |
> | `Manage Transfer Instruments` | Read transfer instruments for payout config |
> | `Authentication Sessions` | Create sessions for KYC components (onboarding product) |

---

### `adyen.balancePlatformApiKey` — Balance Platform / Configuration

| API | Endpoint | Method | Service | Role required |
|-----|----------|--------|---------|---------------|
| **Account Holders** | `/accountHolders` | POST | `AccountHolderService` | Manage account holders |
| **Account Holders** | `/accountHolders/{id}` | PATCH | `AccountHolderService` | Manage account holders |
| **Account Holders** | `/accountHolders/{id}/balanceAccounts` | GET | `BalanceAccountService` | Manage account holders |
| **Balance Accounts** | `/balanceAccounts` | POST | `BalanceAccountService`, `BankingProvisioningService` | Manage balance accounts |
| **Balance Accounts** | `/balanceAccounts/{id}` | GET | `BalanceAccountService`, `StoreManagementService` | Manage balance accounts |
| **Balance Accounts** | `/balanceAccounts/{id}/sweeps` | POST | `PayoutConfigurationService`, `BankingProvisioningService` | Manage sweep configurations |
| **Balance Accounts** | `/balanceAccounts/{id}/sweeps` | GET | `PayoutConfigurationService` | Manage sweep configurations |
| **Payment Instruments** | `/paymentInstruments` | POST | `IssuingService` (card), `BankingProvisioningService` (bank) | Manage payment instruments |
| **Payment Instruments** | `/paymentInstruments/{id}` | GET | `IssuingService`, `BalanceAccountService`, `BankingProvisioningService` | Manage payment instruments |
| **Payment Instruments** | `/paymentInstruments/{id}` | PATCH | `IssuingService` | Manage payment instruments |
| **Payment Instruments** | `/paymentInstruments/reveal` | POST | `IssuingService` | Manage payment instruments - Reveal |
| **Payment Instruments** | `/paymentInstruments/{id}/transactionRules` | GET | `IssuingService` | Manage transaction rules |
| **Transaction Rules** | `/transactionRules` | POST | `IssuingService` | Manage transaction rules |
| **Transaction Rules** | `/transactionRules/{id}` | PATCH | `IssuingService` | Manage transaction rules |
| **Transaction Rules** | `/transactionRules/{id}` | DELETE | `IssuingService` | Manage transaction rules |
| **Manage Card PIN** | `/publicKey` | GET | `IssuingService` | Manage card PIN |
| **SCA Devices** | `/registeredDevices` | GET | `TransferService` | Manage SCA devices |
| **SCA Devices** | `/registeredDevices` | POST | `TransferService` | Manage SCA devices |
| **SCA Devices** | `/registeredDevices/{id}` | PATCH | `TransferService` | Manage SCA devices |
| **SCA Devices** | `/registeredDevices/{id}` | DELETE | `TransferService` | Manage SCA devices |
| **Transfers** | `/btl/v4/transfers` | POST | `TransferService` (with SCA headers) | Manage transfers |
| **Transfers** | `/btl/v4/transfers` | GET | `CardTransferService`, `LedgerService` (accounting journal) | Manage transfers |
| **Transfers** | `/btl/v4/transfers/{id}` | GET | `TransferService` (status of bill payments) | Manage transfers |
| **Transfers** | `/btl/v4/transfers/approve` | POST | `TransferService` (batch approved with one SCA) | Manage transfers |
| **Transfers** | `/btl/v4/transfers/cancel` | POST | `TransferService` (bill payment cancelled) | Manage transfers |
| **Bank Validation** | `/validateBankAccountIdentification` | POST | `BankValidationService` | Manage bank account validation |
| **CoP** | `/bcl/v2/verifyCounterpartyName` | POST | `BankValidationService` | Manage confirmation of payee |
| **Auth Sessions** | `authe/api/v1/sessions` | POST | `AdyenSessionService` (platform product) | Manage authentication sessions |

> **Roles to enable in Customer Area** (Settings > API credentials > Roles):
>
> | Customer Area role name | Used for |
> |---|---|
> | `Balance Platform BCL API` | Account holders, balance accounts |
> | `Balance Platform Manage SCA Devices API` | SCA device registration / listing / deletion |
> | `Balance Platform Transfers API` | Initiate & list transfers (`/btl/v4/transfers`) |
> | `Balance Platform Bank Account Validation API` | Validate bank account identifiers |
> | `Balance Platform Confirmation of Payee API` | Counterparty name verification (`/bcl/v2/verifyCounterpartyName`) |
> | `Balance Platform Payment Instrument API` | Create, read, update payment instruments (cards + bank accounts) |
> | `Balance Platform Payment Instrument Reveal API` | Reveal card PAN/CVV |
> | `Balance Platform Transaction Rules API` | Create, update, delete transaction rules |
> | `Balance Platform Manage Card PIN API` | Get public key for card data encryption |
> | `Balance Platform Sweep Configuration API` | Create & read sweep/payout configurations |
> | `Authentication Sessions` | Create sessions for Platform Experience components (platform product) |

---

### `adyen.pspApiKey` — Checkout / Management / Terminal

| API | Endpoint | Method | Service | Role required |
|-----|----------|--------|---------|---------------|
| **Checkout** | `/v71/sessions` | POST | `PaymentCheckoutService` | Checkout API |
| **Management - Stores** | `/merchants/{id}/stores` | POST | `StoreManagementService` | Management API - Stores |
| **Management - Payment Methods** | `/merchants/{id}/paymentMethodSettings` | POST | `StoreManagementService` | Management API - Payment methods |
| **Management - Payment Methods** | `/merchants/{id}/paymentMethodSettings` | GET | `StoreManagementService` | Management API - Payment methods |
| **Management - Split Config** | `/merchants/{id}/splitConfigurations` | GET | `StoreManagementService` | Management API - Split configurations |
| **Management - Split Config** | `/merchants/{id}/splitConfigurations` | POST | `StoreManagementService` | Management API - Split configurations |
| **Management - Terminals** | `/terminals` | GET | `StoreManagementService` | Management API - Terminals |
| **Terminal (Cloud)** | Cloud sync payment | POST | `PosService` | Terminal API |
| **Recurring** | `/disable` | POST | `PaymentCheckoutService` | Recurring API |
| **Checkout - Payment Links** | `/v71/paymentLinks` | POST | `InvoiceService` (invoices, first payment of subscriptions) | Checkout API |
| **Checkout - Payment Links** | `/v71/paymentLinks/{id}` | GET, PATCH | `InvoiceService` (status, expiry) | Checkout API |
| **Checkout - Payments** | `/v71/payments` | POST | `InvoiceService` (subscription cycles, ContAuth) | Checkout API |
| **Checkout - Cancels** | `/v71/cancels` | POST | `InvoiceService` (stop Auto Rescue) | Checkout API |
| **Recurring** | `/listRecurringDetails` | POST | `SubscriptionService` (token of a subscription) | Recurring API |

> **Roles to enable in Customer Area** (Settings > Users > API credentials > Roles):
>
> | Customer Area role name | Used for |
> |---|---|
> | `Checkout webservice role` | Create payment sessions (`/v71/sessions`), payment links, subscription charges and cancels |
> | `Recurring role` | List & disable stored payment methods |
> | `Management API - Stores read and write` | Create stores |
> | `Management API - Payment methods read and write` | Request & list payment methods per store |
> | `Management API - Split configuration read and write` | Create & list split configurations |
> | `Management API - Terminals read` | List terminals for POS |
> | `Adyen Payments Terminal API` | Cloud sync payments on POS terminals |

---

### `adyen.issuing.pspApiKey` — Issuing Payments (Test Issued Cards)

| API | Endpoint | Method | Service | Role required |
|-----|----------|--------|---------|---------------|
| **Checkout** | `/v71/sessions` | POST | `IssuingPaymentCheckoutService` | Checkout API |
| **Recurring** | `/listRecurringDetails` | POST | `IssuingPaymentCheckoutService` | Recurring API |
| **Recurring** | `/disable` | POST | `IssuingPaymentCheckoutService` | Recurring API |
| **Payments** | `/v71/payments` | POST | `IssuingPaymentCheckoutService` | Checkout API |

> This key is used exclusively for the **Test Issued Cards** page, which allows testing payments with Adyen-issued Visa & Mastercard cards.
> The associated configuration also includes `adyen.issuing.merchantAccount`, `adyen.issuing.clientKey`, and `adyen.issuing.userId`.
>
> **Roles to enable in Customer Area** (Settings > Users > API credentials > Roles):
>
> | Customer Area role name | Used for |
> |---|---|
> | `Checkout webservice role` | Create payment sessions for issuing checkout |
> | `Recurring role` | List & disable stored payment methods |

---

## Project Structure

```
myplatform-demo/
├── backend/
│   ├── src/main/java/com/myplatform/demo/
│   │   ├── controller/          32 REST controllers
│   │   ├── service/             43 services (Adyen API + business logic)
│   │   ├── model/               JPA entities
│   │   ├── dto/                 Data Transfer Objects
│   │   ├── repository/          Spring Data repositories
│   │   ├── configuration/       Config beans
│   │   ├── exception/           Error handling
│   │   └── util/                PDF generation, invoicing & accounting logic (VAT, ledger rules, CSV)
│   └── src/test/java/           JUnit tests of the pure logic
│
├── frontend/src/app/
│       ├── login / signup       Authentication & registration (company import)
│       ├── layout               Sidebar + topbar shell
│       ├── dashboard            Onboarding, KYC, bank account, external accounts, demo data
│       ├── invoices             Customers & invoices (Pay by Link, PDF)
│       ├── subscriptions        Subscriptions (token charges, Auto Rescue)
│       ├── bills                Suppliers & bills (batch transfers, single-use cards)
│       ├── accounting           Journal, payouts, CSV & CAMT.053 exports
│       ├── checkout             Adyen Web SDK payment
│       ├── payment              Transactions (Platform Experience)
│       ├── transfer             Bank transfers + SCA WebAuthn
│       ├── card-create          Virtual card issuance
│       ├── card-list            Card management & data reveal
│       ├── card-transactions    Card transaction history, expenses & receipts
│       ├── issuing-checkout     Test Issued Cards (Visa/MC only)
│       ├── store                Store & payment method setup
│       ├── payout               Payout configuration
│       ├── report               Reports (Platform Experience)
│       ├── dispute              Disputes (Platform Experience)
│       ├── paybylink            Pay By Link (Platform Experience)
│       ├── business-loans       Capital (Platform Experience)
│       ├── pos                  POS terminal payment
│       └── device               SCA device management
│
├── .github/workflows/ci.yml    GitHub Actions CI
└── README.md
```

---

## Prerequisites

- **Java** 17+
- **Maven** 3.8+ (or use `./mvnw`)
- **Node.js** 18+ / **npm** 9+
- A modern browser (Chrome, Firefox, Edge)
- An **Adyen TEST account** with Balance Platform, LEM, Checkout & Management access

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/quentinl-ady/myplatform-demo.git
cd myplatform-demo
```

### 2. Configure

Edit `backend/src/main/resources/application.properties`:

| Property | Description |
|----------|-------------|
| `adyen.balancePlatformApiKey` | Balance Platform API key |
| `adyen.lemApiKey` | Legal Entity Management API key |
| `adyen.pspApiKey` | PSP API key (Checkout / Management) |
| `adyen.merchantAccount` | Merchant account name |
| `adyen.clientKey` | Client key for the frontend SDK |
| `adyen.lemVersion` | LEM API version (default `v4`) |
| `adyen.issuing.card-ranges` | Card ranges (BINs) of the platform, in order of preference: `brandVariant:issuingCountryCode:currency`, comma-separated (e.g. `visa_debit_f:FR:EUR,mc_credit_mco:GB:GBP`). A card uses the first range of its network in the currency of its balance account, preferring the account holder's country. Networks without a range for that currency are greyed out on Create card |
| `adyen.issuing.country` | Issuing country (e.g. `FR`), used when `adyen.issuing.card-ranges` is empty |
| `adyen.issuing.visa.subvariant` | Visa brand variant, used when `adyen.issuing.card-ranges` is empty |
| `adyen.issuing.mastercard.subvariant` | Mastercard brand variant, used when `adyen.issuing.card-ranges` is empty |
| `adyen.issuing.pspApiKey` | PSP API key for issuing card payments |
| `adyen.issuing.merchantAccount` | Merchant account for issuing payments |
| `adyen.issuing.clientKey` | Client key for issuing checkout frontend |
| `adyen.issuing.userId` | Platform userId used for issuing payment context |
| `app.subscriptions.auto-rescue` | `true` only if Adyen enabled Auto Rescue on the merchant account (default `false`). Subscriptions paid by card then offer Auto Rescue: their charges carry `autoRescue` and `maxDaysToRescue`, and the test outcomes include rescue scenarios |

### 3. Start the backend

```bash
cd backend
./mvnw spring-boot:run
```

→ **http://localhost:8080**

### 4. Start the frontend

```bash
cd frontend
npm install
npm start
```

→ **http://localhost:4200**

---

## Database

| | |
|---|---|
| **Engine** | SQLite — zero install |
| **File** | `users.db` (auto-created at first startup) |
| **Schema** | Managed by Hibernate (`ddl-auto=update`) |

---

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push & PR:

| Job | Stack | Command |
|-----|-------|---------|
| **Backend** | Java 17 (Temurin) | `./mvnw compile -B` |
| **Frontend** | Node.js 22 | `npm ci && npm run build` |
---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend framework | Angular | 17.2 |
| UI library | Angular Material | 17.3 |
| Payments SDK | @adyen/adyen-web | 6.22 |
| Platform Experience | @adyen/adyen-platform-experience-web | 1.10 |
| KYC components | @adyen/kyc-components | 4.4 |
| SCA (WebAuthn) | @adyen/bpscaweb | 0.1.5 |
| Backend framework | Spring Boot | 3.2 |
| Adyen API library | adyen-java-api-library | 40.0 |
| Database | SQLite | 3.42 |
| PDF generation | iText | 8.0 |
| JWT | jose4j | 0.9.3 |
| Tests | JUnit 5 + AssertJ (`spring-boot-starter-test`) | Spring Boot 3.2 |
