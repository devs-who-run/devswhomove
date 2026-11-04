export const MAX_PHOTO_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Re-encodes a chosen photo as a JPEG of at most 2048px. Re-encoding drops EXIF data such as GPS
 * coordinates before the image leaves the device and keeps uploads small.
 */
export async function preparePhoto(file: File, maxSide = 2048): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > MAX_PHOTO_INPUT_BYTES) throw new Error('Choose a photo smaller than 25 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('We couldn’t read that photo. Try a JPEG, PNG or WebP image.');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser couldn’t prepare that photo.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Your browser couldn’t prepare that photo.');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is too detailed. Try another one.');
  return blob;
}
