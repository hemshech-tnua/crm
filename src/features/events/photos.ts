// The invitation photograph bundled with the site (the content-security policy allows only our own images).
// By the association's decision there are no AI-generated people here: only a landscape (made with Higgsfield after the
// brand book's photographic language). Photographs of real people come from the device ("בחירה מהמכשיר") and stay on it.
//
// Each photograph carries its art direction, measured by eye on the file (fractions of its width and height):
//   band     the rows that must stay in view
//   corners  where the stripes may enter, in order of preference (top-right belongs to the logo)
import hills from '@/assets/photos/hills.webp';
import type { PhotoArt } from './marketing';

export type BrandPhoto = PhotoArt & { key: string; label: string; url: string };

export const PHOTOS: BrandPhoto[] = [
  {
    key: 'hills', label: 'נוף ודרך', url: hills,
    band: { top: 0.2, bottom: 0.85 },
    corners: ['bottom-left', 'bottom-right', 'top-left'],
  },
];

/** A photograph picked from the device: nothing is known about it, so the crop keeps its middle and the stripes stay small. */
export const DEVICE_ART: PhotoArt = { band: { top: 0.2, bottom: 0.6 }, corners: ['bottom-right', 'bottom-left'] };
