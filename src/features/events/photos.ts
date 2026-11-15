// The invitation photographs, bundled with the site (the content-security policy allows only our own images).
// Made for the association with Higgsfield (AI) after the brand book's photographic language: eye level, motion and
// progress, approachable, military identity without drama. They are illustrations, not real participants: once the
// association has its own photographs of its people, those are better (pick "בחירה מהמכשיר").
import bonfire from '@/assets/photos/bonfire.webp';
import running from '@/assets/photos/running.webp';
import talk from '@/assets/photos/talk.webp';
import walk from '@/assets/photos/walk.webp';
import hills from '@/assets/photos/hills.webp';
import training from '@/assets/photos/training.webp';

export type BrandPhoto = { key: string; label: string; url: string; focus: { x: number; y: number } };

export const PHOTOS: BrandPhoto[] = [
  { key: 'training', label: 'אימון בוקר', url: training, focus: { x: 0.5, y: 0.45 } },
  { key: 'talk', label: 'הרצאה ושיחה', url: talk, focus: { x: 0.5, y: 0.4 } },
  { key: 'bonfire', label: 'ערב מדורה', url: bonfire, focus: { x: 0.5, y: 0.62 } },
  { key: 'running', label: 'ריצה בשבילים', url: running, focus: { x: 0.5, y: 0.3 } },
  { key: 'walk', label: 'מהמדים לאזרחות', url: walk, focus: { x: 0.5, y: 0.3 } },
  { key: 'hills', label: 'נוף ודרך', url: hills, focus: { x: 0.5, y: 0.5 } },
];

/** The photograph that suits the kind of event best. */
export function photoFor(type: 'friday' | 'bonfire' | 'other'): BrandPhoto {
  const key = type === 'bonfire' ? 'bonfire' : type === 'friday' ? 'training' : 'talk';
  return PHOTOS.find((p) => p.key === key)!;
}
