// The invitation photographs, bundled with the site (the content-security policy allows only our own images).
// Made for the association with Higgsfield (AI) after the brand book's photographic language: eye level, motion and
// progress, approachable, military identity without drama. They are illustrations, not real participants: once the
// association has its own photographs of its people, those are better (pick "בחירה מהמכשיר").
//
// Each photograph carries its art direction, measured by eye on the file (fractions of its width and height):
//   band     the rows that must stay in view (the crop centres them, then keeps every face whole)
//   faces    every face (with hair): never cut by the frame, never under the logo or a stripe
//   keep     other subjects that must stay whole and clear of stripes (the fire)
//   corners  where the stripes may enter, in order of preference (top-right belongs to the logo)
//   mirror   drawn mirrored, when the subject would otherwise sit under the logo
import bonfire from '@/assets/photos/bonfire.webp';
import running from '@/assets/photos/running.webp';
import talk from '@/assets/photos/talk.webp';
import walk from '@/assets/photos/walk.webp';
import hills from '@/assets/photos/hills.webp';
import training from '@/assets/photos/training.webp';
import type { PhotoArt } from './marketing';

export type BrandPhoto = PhotoArt & { key: string; label: string; url: string };

export const PHOTOS: BrandPhoto[] = [
  {
    key: 'training', label: 'אימון בוקר', url: training,
    band: { top: 0.2, bottom: 0.6 },
    faces: [[0.02, 0.28, 0.14, 0.37], [0.2, 0.235, 0.27, 0.305], [0.29, 0.25, 0.39, 0.33], [0.43, 0.215, 0.52, 0.3],
      [0.64, 0.295, 0.7, 0.355], [0.79, 0.33, 0.85, 0.385], [0.9, 0.28, 0.975, 0.345], [0.23, 0.45, 0.37, 0.595], [0.69, 0.45, 0.8, 0.575]],
    corners: ['top-left', 'bottom-right', 'bottom-left'],
  },
  {
    key: 'talk', label: 'הרצאה ושיחה', url: talk,
    band: { top: 0.13, bottom: 0.47 },
    faces: [[0.79, 0.13, 0.98, 0.275], [0, 0.295, 0.11, 0.375], [0.13, 0.265, 0.22, 0.345], [0.31, 0.255, 0.385, 0.335],
      [0.46, 0.275, 0.545, 0.355], [0.5, 0.325, 0.625, 0.425], [0.26, 0.31, 0.37, 0.415], [0.18, 0.355, 0.285, 0.465],
      [0, 0.44, 0.23, 0.605], [0.86, 0.415, 1, 0.535], [0.92, 0.515, 1, 0.7]],
    corners: ['bottom-right', 'top-left', 'bottom-left'],
    mirror: true,
  },
  {
    key: 'bonfire', label: 'ערב מדורה', url: bonfire,
    band: { top: 0.52, bottom: 0.92 },
    faces: [[0.1, 0.535, 0.22, 0.645], [0.31, 0.525, 0.415, 0.615], [0.57, 0.55, 0.7, 0.645], [0.78, 0.56, 0.915, 0.685], [0, 0.575, 0.135, 0.705]],
    keep: [[0.46, 0.75, 0.72, 0.93]],
    corners: ['top-left', 'bottom-left', 'bottom-right'],
  },
  {
    key: 'running', label: 'ריצה בשבילים', url: running,
    band: { top: 0.2, bottom: 0.55 },
    faces: [[0.115, 0.215, 0.265, 0.365], [0.39, 0.285, 0.605, 0.405], [0.735, 0.295, 0.855, 0.405]],
    corners: ['bottom-right', 'bottom-left', 'top-left'],
  },
  {
    key: 'walk', label: 'מהמדים לאזרחות', url: walk,
    band: { top: 0.1, bottom: 0.52 },
    faces: [[0.275, 0.175, 0.385, 0.285], [0.56, 0.125, 0.695, 0.245]],
    corners: ['bottom-right', 'bottom-left', 'top-left'],
    mirror: true,
  },
  {
    key: 'hills', label: 'נוף ודרך', url: hills,
    band: { top: 0.2, bottom: 0.85 },
    corners: ['bottom-left', 'bottom-right', 'top-left'],
  },
];

/** A photograph picked from the device: nothing is known about it, so the crop keeps its middle and the stripes stay small. */
export const DEVICE_ART: PhotoArt = { band: { top: 0.2, bottom: 0.6 }, corners: ['bottom-right', 'bottom-left'] };

/** The photograph that suits the kind of event best. */
export function photoFor(type: 'friday' | 'bonfire' | 'other'): BrandPhoto {
  const key = type === 'bonfire' ? 'bonfire' : type === 'friday' ? 'training' : 'talk';
  return PHOTOS.find((p) => p.key === key)!;
}
