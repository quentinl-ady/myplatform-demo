# MyPlatform Demo

A demo application showcasing a full integration of **Adyen for Platforms** products: Embedded Payments, Embedded Financial Products (Banking, Issuing, Capital), and Platform Experience components.  
The project simulates a **marketplace/SaaS platform** that onboards sub-merchants, collects payments, issues virtual cards, opens bank accounts, and performs bank transfers — all through Adyen APIs.

---

## Table of Contents

- [Features](#features)
- [Technical Architecture](#technical-architecture)
- [Adyen APIs Used](#adyen-apis-used)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Database](#database)
- [CI/CD](#cicd)

---

## Features

### Onboarding & KYC
- Creation of **Legal Entities** (Individual, Organization, Sole Proprietorship) via the Legal Entity Management API.
- Generation of a **Hosted Onboarding Page (HOP) link** so sub-merchants can complete their KYC profile.
- Real-time tracking of capability verification statuses (acquiring, payout, banking, issuing, capital).
- **Developer tool**: automated KYC validation (document upload, Terms of Service signing, PCI questionnaire) to speed up testing.
- **Business Lines** management (industry codes, sales channels: POS / eCommerce / Pay By Link).

### Payments (Acquiring)
- Creation of **Stores** linked to a sub-merchant with split payment configuration (platform commission).
- **Payment method** management per store (Visa, Mastercard, Cartes Bancaires, Amex).
- **Payment sessions** via the Checkout API with shopper redirect and result handling (authorised, pending, refused).
- **Pay By Link**: creation and management of payment links.
- **POS Terminal**: synchronous payment via Terminal API (Cloud) on a physical terminal.

### Embedded Financial Products

#### Banking
- Provisioning of **bank accounts** (IBAN for FR/NL, Account Number for US/UK) via the Balance Platform API.
- Display of account balance and details.
- **Bank transfers** (Regular/Instant) with:
  - Automatic detection of bank account format by country (IBAN, Account+Routing Number, Account+Sort Code).
  - Asynchronous bank account format validation.
  - **Beneficiary name verification** (Confirmation of Payee): exact match, partial match, no match.
  - **Strong Customer Authentication (SCA)** via WebAuthn (`@adyen/bpscaweb`) to initiate and finalize transfers.
  - Support for both instant and regular transfers.
- **Automatic sweep** of funds from acquiring to the bank account (cron every 2 minutes).
- **Bank statement (RIB) PDF download for FR IBAN** (generated server-side with iText).

#### Issuing
- Issuance of **virtual cards** (Visa and Mastercard).
- Card **lifecycle management** (active, suspended, closed).
- **Card data reveal** (PAN, CVV, expiry) with RSA/AES encryption on the backend.
- Creation and management of **transaction rules**:
  - Maximum number of transactions (`maxTransactions`).
  - Maximum amount per transaction (`maxAmountPerTransaction`).
  - Total spending cap (`maxTotalAmount`).
  - MCC code blocking (`blockedMccs`).
- **Transaction history** per card.

#### Capital (Business Loans)
- Display of loan offers and management via the Adyen Capital component.

### Platform Experience Components
- **Transactions Overview**: view sub-merchant transactions.
- **Reports Overview**: access reports.
- **Payouts Overview**: track payouts.
- **Disputes**: manage disputes.
- **Pay By Link**: payment link management component.
- **Capital**: loan management component.

### Payout (to external account)
- **Sweep/payout configuration** to Transfer Instruments (external bank accounts).
- Support for regular and instant payouts.

### SCA Device Management
- WebAuthn device registration (initiation + finalization).
- List and delete registered devices.

---

## Technical Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│   Angular 17 SPA    │  HTTP   │   Spring Boot 3.2    │
│   (port 4200)       │◄───────►│   (port 8080)        │
│                     │         │                      │
│ • Angular Material  │         │ • REST Controllers   │
│ • Adyen Web SDK     │         │ • Adyen Java API Lib │
│ • Adyen Platform    │         │ • Spring Data JPA    │
│   Experience Web    │         │ • SQLite             │
│ • Adyen KYC Comps   │         │ • iText PDF          │
│ • Adyen bpscaweb    │         │ • jose4j (JWT)       │
│   (WebAuthn SCA)    │         │                      │
└─────────────────────┘         └──────────┬───────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │   Adyen APIs (TEST)  │
                                │                      │
                                │ • Legal Entity Mgmt  │
                                │ • Balance Platform   │
                                │ • Checkout           │
                                │ • Management         │
                                │ • Transfers          │
                                │ • Terminal (Cloud)   │
                                └──────────────────────┘
```

### Backend (`/backend`)

| Layer | Key Files | Role |
|-------|-----------|------|
| **Controllers** | `UserController`, `IssuingController`, `PosController`, `BankStatementPdfController` | REST endpoints |
| **Services** | `AdyenService`, `KYCService`, `IssuingService`, `PosService`, `CardTransferService`, `RibPdfGeneratorService`, `GpayJwtService` | Business logic & Adyen API calls |
| **Models** | `User`, `Card`, `StoreCustomer`, etc. | JPA entities |
| **Repositories** | `UserRepository`, `CardRepository`, `StoreCustomerRepository` | SQLite data access |
| **DTOs** | `CardResponse`, `UserDTO`, `StoreCustomerDTO`, etc. | Data Transfer Objects |
| **Config** | `RestClientConfig` | RestTemplate configuration |

### Frontend (`/frontend`)

| Component | Purpose |
|-----------|---------|
| `login` | Authentication |
| `signup` | Registration & Legal Entity + Account Holder creation |
| `dashboard` | Onboarding HOP, KYC status, Business Lines, Bank Account, External Bank Accounts |
| `checkout` / `checkoutredirect` | Payment via Adyen Web SDK |
| `payment` | Transaction view (Platform Experience) |
| `transfer` | Bank transfers with SCA WebAuthn |
| `card-create` / `card-list` / `card-transactions` | Issuing: card creation, listing, and transactions |
| `store` | Store and payment method management |
| `payout` | Payout configuration |
| `report` | Reports (Platform Experience) |
| `dispute` | Disputes (Platform Experience) |
| `paybylink` | Pay By Link (Platform Experience) |
| `business-loans` | Capital / Business Loans (Platform Experience) |
| `pos` | POS terminal payment |
| `device` | SCA device management |

---

## Adyen APIs Used

| API | Version | Usage |
|-----|---------|-------|
| **Legal Entity Management** | v4 | Create/update legal entities, KYC documents, Terms of Service, PCI |
| **Balance Platform** | v2 | Account holders, balance accounts, payment instruments, sweeps, transaction rules, SCA devices |
| **Checkout** | v71 | Payment sessions, payment details |
| **Management** | v3 | Stores, payment methods, split configurations, terminals |
| **Transfers** | v4 | Bank transfers (SEPA, Faster Payments, ACH) |
| **Terminal (Cloud)** | – | Synchronous POS payments |
| **Authentication Sessions** | v1 | Sessions for Platform Experience components and KYC components |

---

## Project Structure

```
myplatform-demo/
├── backend/                          # Spring Boot API
│   ├── src/main/java/com/myplatform/demo/
│   │   ├── controller/               # REST endpoints
│   │   ├── service/                   # Business logic & Adyen API calls
│   │   ├── model/                     # JPA entities
│   │   ├── dto/                       # Data Transfer Objects
│   │   ├── repository/                # Spring Data repositories
│   │   ├── configuration/             # Config beans
│   │   └── util/                      # Utilities (PDF generation)
│   ├── src/main/resources/
│   │   ├── application.properties     # Active configuration
│   │   ├── application.properties.*   # Profiles per merchant account
│   │   └── *.pem                      # Keys for Google Pay JWT
│   └── pom.xml
├── frontend/                          # Angular SPA
│   ├── src/app/
│   │   ├── dashboard/                 # Onboarding & profile
│   │   ├── checkout/                  # Payments
│   │   ├── transfer/                  # Bank transfers
│   │   ├── card-*/                    # Issuing
│   │   ├── store/                     # Store management
│   │   ├── payment/                   # Transactions
│   │   ├── payout/                    # Payouts
│   │   ├── pos/                       # POS terminal
│   │   └── ...
│   ├── package.json
│   └── angular.json
├── .github/workflows/ci.yml          # GitHub Actions CI
└── README.md
```

---

## Prerequisites

- **Java** 17+
- **Maven** 3.8+ (or use the included Maven Wrapper `./mvnw`)
- **Node.js** 18+ / **npm** 9+
- Modern browser (Chrome, Firefox, Edge)
- **Adyen account** with access to Balance Platform, LEM, Checkout, and Management APIs (TEST environment)
- Recommended IDE: IntelliJ IDEA or VS Code

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/quentinl-ady/myplatform-demo.git
cd myplatform-demo
```

### 2. Install the frontend

```bash
cd frontend
npm install
```

### 3. Install the backend

```bash
cd ../backend
./mvnw clean install
```

---

## Configuration

**Properties to configure** in `backend/src/main/resources/application.properties`:

| Property | Description |
|----------|-------------|
| `adyen.balancePlatformApiKey` | Balance Platform API key |
| `adyen.lemApiKey` | Legal Entity Management API key |
| `adyen.pspApiKey` | PSP API key (Checkout/Management) |
| `adyen.merchantAccount` | Merchant account name |
| `adyen.clientKey` | Client Key for the frontend (Adyen Web SDK) |
| `adyen.lemVersion` | LEM API version (`v4`) |
| `adyen.issuing.country` | Card issuing country (e.g. `FR`) |
| `adyen.issuing.visa.subvariant` | Visa brand variant |
| `adyen.issuing.mastercard.subvariant` | Mastercard brand variant |

---

## Running the Application

### 1. Start the backend

```bash
cd backend
./mvnw spring-boot:run
```

The backend will be available at **http://localhost:8080**.

### 2. Start the frontend

```bash
cd frontend
npm start
```

The frontend will be available at **http://localhost:4200**.

---

## Database

- **SQLite** is used as a local database (no installation required).
- The `users.db` file is automatically created in the `backend/` folder on first startup.
- The schema is managed automatically by Hibernate (`ddl-auto=update`).

---

## CI/CD

A **GitHub Actions** workflow (`.github/workflows/ci.yml`) checks compilation on every push/PR:
- **Backend**: `./mvnw compile` with Java 17
- **Frontend**: `npm ci && npm run build` with Node.js 22
