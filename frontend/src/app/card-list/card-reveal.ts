import * as forge from 'node-forge';
import { firstValueFrom } from 'rxjs';
import { IssuingService } from '../services';

/** The details of a card as Adyen reveals them. */
export interface RevealedCard {
  pan: string;
  cvc: string;
  expiryMonth: string;
  expiryYear: string;
}

/** Revealed details are hidden again after this delay. */
export const REVEAL_DURATION_MS = 30000;

/** Reads the number, expiry date and security code of a card with Adyen's PAN reveal. */
export async function revealCard(issuingService: IssuingService, paymentInstrumentId: string): Promise<RevealedCard> {
  const { publicKey: publicKeyRaw } = await firstValueFrom(issuingService.getPublicKey('panReveal'));

  let publicKeyPem = publicKeyRaw;
  if (!publicKeyPem.includes('-----BEGIN')) {
    publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyPem}\n-----END PUBLIC KEY-----`;
  }

  // Adyen PAN reveal: a random AES-256 key, encrypted with Adyen's RSA key (PKCS1 v1.5), hex encoded.
  const aesKeyBytes = forge.random.getBytesSync(32);
  const rsaPublicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const encryptedAesKey = rsaPublicKey.encrypt(aesKeyBytes, 'RSAES-PKCS1-V1_5');
  const encryptedKeyHex = forge.util.bytesToHex(encryptedAesKey);

  const { encryptedData: encryptedDataHex } = await firstValueFrom(
    issuingService.revealCardData(paymentInstrumentId, encryptedKeyHex)
  );

  // The response is AES-256-CBC encrypted with a zero IV.
  const decipher = forge.cipher.createDecipher('AES-CBC', aesKeyBytes);
  decipher.start({ iv: forge.util.createBuffer('\0'.repeat(16)) });
  decipher.update(forge.util.createBuffer(forge.util.hexToBytes(encryptedDataHex)));
  if (!decipher.finish()) {
    throw new Error('AES decryption failed');
  }

  const parsedData = JSON.parse(decipher.output.toString());
  return {
    pan: parsedData.pan,
    cvc: parsedData.cvc,
    expiryMonth: parsedData.expiration?.month,
    expiryYear: parsedData.expiration?.year
  };
}

/** The details as one spreadsheet row: number, expiry date, security code and cardholder. */
export function revealedCardText(card: RevealedCard, cardholderName: string): string {
  const expiry = `${card.expiryMonth}/${card.expiryYear?.toString().slice(-2)}`;
  return `${card.pan}\t${expiry}\t${card.cvc}\t${cardholderName}`;
}
