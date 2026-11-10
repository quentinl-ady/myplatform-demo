export interface AuthPayload {
  email: string;
  password: string;
}

/** The company record of a business, imported from its system at sign-up to prefill its legal entity. */
export interface CompanyRecord {
  country: string;
  /** Given to an organization, not to a sole proprietorship. */
  legalForm: string;
  /** Postal lines of the registered office, the country last. */
  address: string[];
  registrationNumber: string;
  /** Null where the country has no VAT. */
  vatNumber: string | null;
  phone: string;
}
