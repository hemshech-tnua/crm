// The photo of a speaker or instructor for the public meeting page: cropped in the browser to a 4:5 portrait, at most
// 800×1000, and stored in the public Storage bucket `people` (never in the git repository). Only admins and
// coordinators may write to the bucket (storage RLS in supabase/migrations/20261106002500_meeting_details.sql).
import { PEOPLE_BUCKET, supabase } from '@/lib/supabase';

const MAX_W = 800;
const RATIO = 4 / 5;
const MAX_BYTES = 2 * 1024 * 1024;

export class PhotoError extends Error {}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new PhotoError('לא הצלחנו לקרוא את הקובץ. צריך תמונה מסוג JPG, PNG או WebP.');
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Center-crop to 4:5 and scale down to 800×1000 at most; WebP where the browser can write it, JPEG otherwise. */
export async function preparePhoto(file: File): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  if (!file.type.startsWith('image/')) throw new PhotoError('צריך לבחור קובץ תמונה.');
  const img = await decode(file);
  const cropW = img.width / img.height > RATIO ? Math.round(img.height * RATIO) : img.width;
  const cropH = Math.round(cropW / RATIO);
  const sx = Math.round((img.width - cropW) / 2);
  const sy = Math.round((img.height - cropH) / 2);
  const outW = Math.min(MAX_W, cropW);
  const outH = Math.round(outW / RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('הדפדפן לא הצליח לעבד את התמונה.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);
  img.close();
  let blob = await toBlob(canvas, 'image/webp', 0.85);
  let ext: 'webp' | 'jpg' = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob(canvas, 'image/jpeg', 0.86);
    ext = 'jpg';
  }
  if (!blob) throw new PhotoError('הדפדפן לא הצליח לעבד את התמונה.');
  if (blob.size > MAX_BYTES) throw new PhotoError('התמונה גדולה מדי גם אחרי הקטנה (עד 2MB).');
  return { blob, ext };
}

/**
 * Upload under a random name (`<uuid>-<timestamp>.<ext>`): a new name for every photo, so caches never show an old one,
 * and nothing internal (such as the speaker's row id) appears in the public file name.
 */
export async function uploadPhoto(file: File): Promise<string> {
  const { blob, ext } = await preparePhoto(file);
  const path = `${crypto.randomUUID()}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(PEOPLE_BUCKET).upload(path, blob, {
    contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function removePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(PEOPLE_BUCKET).remove([path]);
  if (error) throw error;
}
