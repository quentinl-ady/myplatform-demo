import { test, expect, Page } from '@playwright/test';

/**
 * End-to-end test: full sub-merchant lifecycle
 *
 * Flow:
 *   1. Sign up a new organization (with bank + issuing capabilities)
 *   2. Validate KYC (developer shortcut)
 *   3. Check onboarding status → all valid
 *   4. Create a bank account
 *   5. Navigate to card creation and issue a virtual card
 *
 * Two variants are run: one with country FR, one with country NL.
 *
 * Prerequisites:
 *   - Backend running on http://localhost:8080
 *   - Frontend running on http://localhost:4200
 */

const uniqueSuffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

interface CountryVariant {
  countryCode: string;
  countryLabel: string;
  currencyCode: string;
}

const variants: CountryVariant[] = [
  { countryCode: 'FR', countryLabel: 'France', currencyCode: 'EUR' },
  { countryCode: 'NL', countryLabel: 'Netherlands', currencyCode: 'EUR' },
];

/**
 * Helper: select a value from a Material mat-select identified by its formControlName.
 * Opens the overlay panel, then clicks the matching mat-option.
 */
async function selectMatOption(page: Page, formControlName: string, value: string) {
  const matSelect = page.locator(`mat-select[formcontrolname="${formControlName}"]`);
  await matSelect.scrollIntoViewIfNeeded();
  await matSelect.click();
  // Wait for the overlay panel to appear
  const panel = page.locator('.mat-mdc-select-panel');
  await panel.waitFor({ state: 'visible', timeout: 5_000 });
  // Click the option by its value attribute for precision
  await page.locator(`mat-option[value="${value}"]`).click();
  // Wait for the overlay to close
  await panel.waitFor({ state: 'hidden', timeout: 5_000 });
}

for (const variant of variants) {
  test.describe.serial(`Full onboarding flow [${variant.countryCode}]: signup → KYC → bank account → card`, () => {
    let userId: string;

    test(`1 — Sign up a new sub-merchant (${variant.countryLabel})`, async ({ page }) => {
      await page.goto('/');

      // The homepage defaults to "login" view. Switch to "signup".
      const signupLink = page.locator('a.switch-link', { hasText: 'Sign up' });
      await signupLink.click();

      // Wait for the signup form to be visible
      await expect(page.locator('app-signup form')).toBeVisible();

      // --- Fill the signup form ---

      // User type: organization (default)
      // Activity reason: marketplace (default)

      // Enable bank + issuing capabilities
      // mat-checkbox requires clicking the inner label element to toggle
      await page.locator('mat-checkbox[formcontrolname="bank"] label').click();
      await page.locator('mat-checkbox[formcontrolname="issuing"] label').click();

      // Company name
      const suffix = uniqueSuffix();
      const companyName = `E2E TestCorp ${variant.countryCode} ${suffix}`;
      await page.locator('input[formcontrolname="legalEntityName"]').fill(companyName);

      // Select country
      await selectMatOption(page, 'countryCode', variant.countryCode);

      // Select currency
      await selectMatOption(page, 'currencyCode', variant.currencyCode);

      // Email
      const emailInput = page.locator('input[formcontrolname="email"]');
      await emailInput.scrollIntoViewIfNeeded();
      const email = `e2e-${variant.countryCode.toLowerCase()}-${suffix}@test.example.com`;
      await emailInput.fill(email);

      // Password
      const passwordInput = page.locator('input[formcontrolname="password"]');
      await passwordInput.scrollIntoViewIfNeeded();
      await passwordInput.fill('test1234');

      // Submit
      const signUpButton = page.locator('button[color="accent"]', { hasText: 'Sign Up' });
      await signUpButton.scrollIntoViewIfNeeded();
      await expect(signUpButton).toBeEnabled();
      await signUpButton.click();

      // After successful signup, the app navigates to /:id/dashboard
      await page.waitForURL(/\/\d+\/dashboard/, { timeout: 30_000 });

      // Extract userId from the URL
      const url = page.url();
      const match = url.match(/\/(\d+)\/dashboard/);
      expect(match).toBeTruthy();
      userId = match![1];
      console.log(`✅ [${variant.countryCode}] Sub-merchant created with ID: ${userId}`);

      // Verify dashboard loaded
      await expect(page.locator('h2', { hasText: 'Onboarding & Profile' })).toBeVisible();
    });

    test(`2 — Validate KYC (${variant.countryLabel})`, async ({ page }) => {
      expect(userId).toBeTruthy();
      await page.goto(`/${userId}/dashboard`);

      // Wait for the dashboard to load
      await expect(page.locator('h2', { hasText: 'Onboarding & Profile' })).toBeVisible();

      // Click "Validate KYC" developer tool button
      const validateKycButton = page.locator('button', { hasText: 'Validate KYC' });
      await expect(validateKycButton).toBeVisible();
      await validateKycButton.click();

      // Wait for the snackbar confirmation
      await expect(page.locator('simple-snack-bar, mat-snack-bar-container').first())
        .toContainText('KYC validated', { timeout: 30_000 });

      console.log(`✅ [${variant.countryCode}] KYC validated for user ${userId}`);
    });

    test(`3 — Check onboarding status (${variant.countryLabel})`, async ({ page }) => {
      expect(userId).toBeTruthy();
      await page.goto(`/${userId}/dashboard`);

      await expect(page.locator('h2', { hasText: 'Onboarding & Profile' })).toBeVisible();

      // KYC validation is asynchronous — poll "Check Status" until Acquiring is validated.
      // Note: Payout is NOT auto-validated so we don't assert on it.
      //       Bank Account & Issuing statuses may not appear in the response.
      const acquiringValidated = page.locator('.status-item', { hasText: 'Acquiring' }).locator('.status-value', { hasText: 'Validated' });
      const maxAttempts = 10;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const checkStatusButton = page.locator('button', { hasText: 'Check Status' });
        await expect(checkStatusButton).toBeVisible();
        await checkStatusButton.click();

        try {
          await acquiringValidated.waitFor({ state: 'visible', timeout: 5_000 });
          break;
        } catch {
          if (attempt === maxAttempts) {
            throw new Error(`Acquiring not validated after ${maxAttempts} attempts`);
          }
          console.log(`  ⏳ [${variant.countryCode}] Attempt ${attempt}/${maxAttempts} — Acquiring not yet validated, retrying in 5s…`);
          await page.waitForTimeout(5_000);
        }
      }

      // Acquiring must be validated
      await expect(acquiringValidated).toBeVisible();
      console.log(`  ✅ [${variant.countryCode}] Acquiring: Validated`);

      // Log all visible status items
      const statusItems = page.locator('.status-item');
      const count = await statusItems.count();
      for (let i = 0; i < count; i++) {
        const label = await statusItems.nth(i).locator('.status-label').textContent();
        const value = await statusItems.nth(i).locator('.status-value').textContent();
        if (label?.trim() !== 'Acquiring') {
          console.log(`  ℹ️  [${variant.countryCode}] ${label?.trim()}: ${value?.trim()}`);
        }
      }

      console.log(`✅ [${variant.countryCode}] Onboarding status checked`);
    });

    test(`4 — Create a bank account (${variant.countryLabel})`, async ({ page }) => {
      expect(userId).toBeTruthy();

      // The banking card only appears once the backend has provisioned the banking capability.
      // This can take time after KYC validation — retry with page reloads.
      const bankingCard = page.locator('mat-card.banking-card');
      const maxReloads = 8;

      for (let attempt = 1; attempt <= maxReloads; attempt++) {
        await page.goto(`/${userId}/dashboard`);
        await expect(page.locator('h2', { hasText: 'Onboarding & Profile' })).toBeVisible();

        // Wait for the API call to complete and the component to render
        await page.waitForTimeout(3_000);

        const visible = await bankingCard.isVisible().catch(() => false);
        if (visible) break;

        if (attempt === maxReloads) {
          throw new Error(`Banking card not visible after ${maxReloads} reloads — banking capability may not be provisioned`);
        }
        console.log(`  ⏳ [${variant.countryCode}] Attempt ${attempt}/${maxReloads} — banking card not visible, reloading in 5s…`);
        await page.waitForTimeout(5_000);
      }

      // Click "Create Bank Account" button
      const createBankBtn = bankingCard.locator('button.bank-create-btn', { hasText: 'Create Bank Account' });

      // The button might be disabled if bankingAllowed is not yet true.
      // Wait for it to be enabled (i.e. not have the "disabled" class)
      await expect(createBankBtn).not.toHaveClass(/disabled/, { timeout: 15_000 });
      await createBankBtn.click();

      // Wait for the snackbar confirmation
      await expect(page.locator('simple-snack-bar, mat-snack-bar-container').first())
        .toContainText('Bank account created', { timeout: 30_000 });

      // After creation the bank status polling should show "Account active"
      await expect(bankingCard.locator('.bank-status-badge', { hasText: 'Account active' }))
        .toBeVisible({ timeout: 30_000 });

      console.log(`✅ [${variant.countryCode}] Bank account created for user ${userId}`);
    });

    test(`5 — Issue a virtual card (${variant.countryLabel})`, async ({ page }) => {
      expect(userId).toBeTruthy();
      await page.goto(`/${userId}/card-create`);

      // Wait for the card creation form
      await expect(page.locator('h1', { hasText: 'Create Virtual Card' })).toBeVisible({ timeout: 15_000 });

      // Fill cardholder name
      await page.locator('input[formcontrolname="cardholderName"]').fill('E2E Test Cardholder');

      // Brand: keep default "visa"

      // Submit the card creation form
      const createCardBtn = page.locator('button[type="submit"]', { hasText: 'Create Card' });
      await expect(createCardBtn).toBeEnabled();
      await createCardBtn.click();

      // Wait for the success card to appear
      await expect(page.locator('.success-card h2', { hasText: 'Card Created Successfully' }))
        .toBeVisible({ timeout: 30_000 });

      // Verify card details are displayed
      await expect(page.locator('.success-details .detail-row .value', { hasText: 'E2E Test Cardholder' }))
        .toBeVisible();

      // Verify we can navigate to "View My Cards"
      const viewCardsBtn = page.locator('button', { hasText: 'View My Cards' });
      await expect(viewCardsBtn).toBeVisible();
      await viewCardsBtn.click();

      await page.waitForURL(new RegExp(`/${userId}/cards`), { timeout: 10_000 });
      console.log(`✅ [${variant.countryCode}] Virtual card issued for user ${userId}`);
    });
  });
}
