import QRCode from 'qrcode';

/**
 * Genera un código QR en DataURL (PNG) para incrustar directamente en la vista TV.
 */
export async function generateQrDataUrl(text) {
  return QRCode.toDataURL(text, {
    width: 280,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

