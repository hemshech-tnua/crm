import type { ReactNode } from 'react';
import { Stripes } from '@/ui/Shapes';
import { cx } from '@/ui/kit';

/**
 * The brand book's poster grid on a page: an image zone (a photograph, beige stripes entering from the corner opposite
 * the logo, never over faces) above a navy content zone with the headline on the right. Headlines are short (up to
 * five words) and the photograph is decorative, so it has no alt text.
 */
export function Hero({ photo, kicker, title, children, position = 'center', className }: {
  photo: string; kicker?: ReactNode; title: ReactNode; children?: ReactNode; position?: string; className?: string;
}) {
  return (
    <section className={cx('-mx-5 -mt-6 overflow-hidden bg-ink text-light sm:mx-0 sm:mt-0 sm:rounded-[var(--radius-panel)]', className)}>
      <div className="relative aspect-[16/10] overflow-hidden">
        <img src={photo} alt="" decoding="async" fetchPriority="high" className="h-full w-full object-cover" style={{ objectPosition: position }} />
        <Stripes width={160} height={160} unit={18} dir="rise" corner={{ at: 'bottom-left', size: 150 }} className="absolute bottom-0 left-0 h-[42%] w-auto max-w-[45%] text-light" />
      </div>
      <div className="px-5 pt-5 pb-6 sm:px-6">
        {kicker && <div className="font-display text-[1.15rem] font-semibold">{kicker}</div>}
        <h1 className="font-display text-[2.4rem] leading-[1.02] sm:text-[2.8rem]">{title}</h1>
        {children && <div className="mt-3 text-[1.02rem] leading-relaxed text-light/90">{children}</div>}
      </div>
    </section>
  );
}
