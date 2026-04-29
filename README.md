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
| **Payments** | Store creation with split config · Payment method setup (Visa, MC, CB, Amex) · Checkout sessions with redirect · Pay By Link · POS via Terminal API (Cloud) |
| **Banking** | Bank account provisioning (IBAN / Account Number) · Balance display · Transfers (Regular & Instant) with country-aware format detection, async validation, Confirmation of Payee, SCA via WebAuthn · Auto-sweep (cron) · RIB PDF download (iText) |
| **Issuing** | Virtual card creation (Visa / MC) · Lifecycle mgmt (active / suspended / closed) · Card data reveal (RSA/AES) · Transaction rules (max txns, max amount, total cap, MCC blocking) · Transaction history |
| **Capital** | Loan offers display & management via Adyen Capital component |
| **Payouts** | Sweep/payout config to external bank accounts · Regular & instant |
| **Platform Experience** | Transactions overview · Reports · Payouts · Disputes · Pay By Link · Capital |
| **Security** | SCA device registration & management via WebAuthn (`@adyen/bpscaweb`) |

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

The application uses **3 separate API keys**, each mapped to a dedicated `Client` bean in `AdyenClientConfig.java`.

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
| **Transfers** | `/btl/v4/transfers` | GET | `CardTransferService` | Manage transfers |
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

> **Roles to enable in Customer Area** (Settings > Users > API credentials > Roles):
>
> | Customer Area role name | Used for |
> |---|---|
> | `Checkout webservice role` | Create payment sessions (`/v71/sessions`) |
> | `Management API - Stores read and write` | Create stores |
> | `Management API - Payment methods read and write` | Request & list payment methods per store |
> | `Management API - Split configuration read and write` | Create & list split configurations |
> | `Management API - Terminals read` | List terminals for POS |
> | `Adyen Payments Terminal API` | Cloud sync payments on POS terminals |

---

## Project Structure

```
myplatform-demo/
├── backend/
│   └── src/main/java/com/myplatform/demo/
│       ├── controller/          14 REST controllers
│       ├── service/             16 services (Adyen API + business logic)
│       ├── model/               JPA entities
│       ├── dto/                 Data Transfer Objects
│       ├── repository/          Spring Data repositories
│       ├── configuration/       Config beans
│       ├── exception/           Error handling
│       └── util/                PDF generation
│
├── frontend/src/app/
│       ├── login / signup       Authentication & registration
│       ├── layout               Sidebar + topbar shell
│       ├── dashboard            Onboarding, KYC, bank account, external accounts
│       ├── checkout             Adyen Web SDK payment
│       ├── payment              Transactions (Platform Experience)
│       ├── transfer             Bank transfers + SCA WebAuthn
│       ├── card-create          Virtual card issuance
│       ├── card-list            Card management & data reveal
│       ├── card-transactions    Card transaction history
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
| `adyen.issuing.country` | Issuing country (e.g. `FR`) |
| `adyen.issuing.visa.subvariant` | Visa brand variant |
| `adyen.issuing.mastercard.subvariant` | Mastercard brand variant |

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
