// The public pages' photograph, in three widths (generated from hills.webp with ImageMagick; hills.webp itself is
// also the staff's marketing photo, so it stays as it is). The browser picks the smallest one that is sharp enough.
import hills from '@/assets/photos/hills.webp';
import hills640 from '@/assets/photos/hills-640.webp';
import hills1024 from '@/assets/photos/hills-1024.webp';

export type Photo = { src: string; srcSet: string };

export const HILLS: Photo = { src: hills, srcSet: `${hills640} 640w, ${hills1024} 1024w, ${hills} 1600w` };
