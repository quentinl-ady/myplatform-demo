import qrcode from 'qrcode-generator';

export interface QrCode {
  /** Width and height in modules, quiet zone included. */
  size: number;
  /** The dark modules, as the data of a single SVG path. */
  path: string;
}

/** QR code of a text, drawn as SVG data rather than HTML so that it needs no sanitizing. */
export function qrCode(text: string, quietZone = 4): QrCode {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        path += `M${col + quietZone} ${row + quietZone}h1v1h-1z`;
      }
    }
  }
  return { size: count + quietZone * 2, path };
}
