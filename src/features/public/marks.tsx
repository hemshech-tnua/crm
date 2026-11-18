// A few extra stroke glyphs for the public pages, drawn on the same 24px grid and stroke as src/ui/Icon.
const GLYPHS = {
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.2 2',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  coffee: 'M4.5 10h11v3.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V10zM15.5 11.5h1.3a2.3 2.3 0 0 1 0 4.6h-1.6M4 21h12.5M8.3 3.8c-.9 1 .9 2.2 0 3.2M11.8 3.8c-.9 1 .9 2.2 0 3.2',
  heart: 'M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z',
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, size = 18, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}
