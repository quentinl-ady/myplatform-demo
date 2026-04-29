export type VerificationStatus = 'invalid' | 'pending' | 'reject' | 'valid';

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
