import { describe, expect, it } from 'vitest';
import { sanitizeImage } from './images';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (char) => char.charCodeAt(0)) : part,
    ),
  );
const text = (data: Uint8Array) => String.fromCharCode(...data);
const be32 = (value: number) => [
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const le32 = (value: number) => [
  value & 255,
  (value >>> 8) & 255,
  (value >>> 16) & 255,
  value >>> 24,
];

const jpegWithGps = () =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x07],
    'JFIF\0',
    [0xff, 0xe1, 0x00, 0x0f],
    'Exif\0\0GPS:52N',
    [0xff, 0xfe, 0x00, 0x06],
    'note',
    [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9],
  );

describe('sanitizeImage', () => {
  it('removes EXIF and comments from JPEG while keeping image data', () => {
    const result = sanitizeImage(jpegWithGps());
    expect(result.type).toBe('image/jpeg');
    expect(text(result.bytes)).not.toContain('GPS');
    expect(text(result.bytes)).not.toContain('note');
    expect(text(result.bytes)).toContain('JFIF');
    expect(Array.from(result.bytes.slice(-6))).toEqual([0x01, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  });

  it('removes text and EXIF chunks from PNG', () => {
    const chunk = (type: string, data: string) => [
      ...be32(data.length),
      ...bytes(type, data),
      0,
      0,
      0,
      0,
    ];
    const png = bytes(
      '\x89PNG\r\n\x1a\n',
      chunk('IHDR', 'header-data..'),
      chunk('tEXt', 'GPS:52N'),
      chunk('eXIf', 'GPS:52N'),
      chunk('IDAT', 'pixels'),
      chunk('IEND', ''),
    );
    const result = sanitizeImage(png);
    expect(result.type).toBe('image/png');
    expect(text(result.bytes)).not.toContain('GPS');
    expect(text(result.bytes)).toContain('IDAT');
  });

  it('removes EXIF and XMP chunks from WebP and fixes the container', () => {
    const chunk = (type: string, data: number[]) => [
      ...bytes(type),
      ...le32(data.length),
      ...data,
      ...(data.length % 2 ? [0] : []),
    ];
    const body = [
      ...chunk('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...chunk('VP8L', [1, 2, 3]),
      ...chunk('EXIF', Array.from(bytes('GPS:52N'))),
      ...chunk('XMP ', Array.from(bytes('GPS'))),
    ];
    const result = sanitizeImage(bytes('RIFF', le32(body.length + 4), 'WEBP', body));
    const view = new DataView(result.bytes.buffer);
    expect(result.type).toBe('image/webp');
    expect(text(result.bytes)).not.toContain('GPS');
    expect(view.getUint32(4, true)).toBe(result.bytes.length - 8);
    expect(result.bytes[20] & 0x0c).toBe(0);
  });

  it('rejects files that are not supported images', () => {
    expect(() => sanitizeImage(bytes('<svg onload="alert(1)"></svg>'))).toThrow(/valid JPEG/);
    expect(() => sanitizeImage(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow();
  });
});
