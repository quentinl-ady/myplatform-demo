import { TransferPriority } from '../models';

export interface TransferSpeed {
  priority: TransferPriority;
  label: string;
  timing: string;
}

/** The speeds of a bank transfer, the cheapest first. */
export const TRANSFER_SPEEDS: readonly TransferSpeed[] = [
  { priority: 'regular', label: 'Regular', timing: '1–2 business days' },
  { priority: 'fast', label: 'Fast', timing: 'Same business day' },
  { priority: 'instant', label: 'Instant', timing: 'Within seconds' }
];
