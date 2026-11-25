export interface UserBranding {
  userId: string;
  platformName: string | null;
  logoData: string | null;
  logoType: string | null;
  /** Hosted onboarding theme. */
  themeId: string | null;
  /** Theme of the payment links created for invoices and subscriptions. */
  payByLinkThemeId: string | null;
}
