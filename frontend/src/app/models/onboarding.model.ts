/** 'reject' is a legacy spelling still handled by some screens; Adyen sends 'rejected'. */
export type VerificationStatus = 'invalid' | 'pending' | 'rejected' | 'reject' | 'valid';

export interface OnboardingPart {
  allowed: boolean;
  verificationStatus: VerificationStatus;
}

export interface OnboardingResponse {
  acquiringStatus: OnboardingPart;
  payoutStatus: OnboardingPart;
  capitalStatus?: OnboardingPart;
  bankingStatus?: OnboardingPart;
  issuingStatus?: OnboardingPart;
}
