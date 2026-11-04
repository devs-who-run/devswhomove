import { HttpError } from './validation';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const invalid = () => new HttpError(400, 'Upload a valid JPEG, PNG or WebP image.');
const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

// Keep APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform); drop EXIF, XMP, IPTC and comments.
function jpeg(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw invalid();
    while (bytes[offset + 1] === 0xff) offset++;
    const marker = bytes[offset + 1];
    if (marker === undefined) throw invalid();
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      return concat(parts);
    }
    if (marker === 0xd9) throw invalid();
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) throw invalid();
    const metadata =
      (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee) || marker === 0xfe;
    if (!metadata) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  throw invalid();
}

const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function png(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) throw invalid();
    if (!PNG_METADATA.has(type)) parts.push(bytes.subarray(offset, end));
    if (type === 'IEND') return concat(parts);
    offset = end;
  }
  throw invalid();
}

function webp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) throw invalid();
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = bytes.slice(offset, end);
      if (type === 'VP8X' && size >= 1) chunk[8] &= ~0x0c;
      parts.push(chunk);
    }
    offset = end;
  }
  if (offset !== bytes.length || parts.length === 0) throw invalid();
  const body = concat(parts);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}

/** Detects the real image type from its bytes and removes location and other embedded metadata. */
export function sanitizeImage(bytes: Uint8Array): { bytes: Uint8Array; type: ImageType } {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { bytes: jpeg(bytes), type: 'image/jpeg' };
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n')
    return { bytes: png(bytes), type: 'image/png' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP')
    return { bytes: webp(bytes), type: 'image/webp' };
  throw invalid();
}
