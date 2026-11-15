import type { ReactNode } from 'react';
import { Stripes } from '@/ui/Shapes';
import { cx } from '@/ui/kit';

/**
 * The brand book's poster grid on a page: an image zone (a photograph, beige stripes entering from the corner opposite
 * the logo, cut by the photo's bottom edge, never over faces) and a navy content zone with the headline.
 * Phone: the image zone above the content zone, short, so the next meeting is still on the first screen.
 * Wide screen: side by side, the content zone on the right (where Hebrew starts) and the photograph on the left.
 * Headlines are short (up to five words) and the photograph is decorative, so it has no alt text.
 */
export function Hero({ photo, kicker, title, children, position = 'center', className }: {
  photo: string; kicker?: ReactNode; title: ReactNode; children?: ReactNode; position?: string; className?: string;
}) {
  return (
    <section className={cx(
      '-mx-5 -mt-6 flex flex-col overflow-hidden bg-ink text-light sm:mx-0 sm:mt-0 sm:rounded-[var(--radius-panel)] lg:grid lg:min-h-[23rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]',
      className,
    )}>
      <div className="flex flex-col justify-center px-5 pt-4 pb-5 sm:px-7 sm:pt-6 sm:pb-7 lg:px-10 lg:py-12">
        {kicker && <p className="font-display text-heading sm:text-section">{kicker}</p>}
        <h1 className="font-display text-[2.25rem] leading-[1.02] sm:text-hero lg:text-[3.75rem]">{title}</h1>
        {children && <div className="mt-1.5 text-body text-light/90 sm:mt-3 lg:mt-5 lg:max-w-md lg:text-[1.0625rem]">{children}</div>}
      </div>
      <div className="relative order-first aspect-[3/1] overflow-hidden sm:aspect-[16/7] lg:order-none lg:aspect-auto">
        <img src={photo} alt="" decoding="async" fetchPriority="high" className="h-full w-full object-cover lg:absolute lg:inset-0" style={{ objectPosition: position }} />
        <Stripes width={200} height={90} unit={20} dir="fall" count={3} offset={0} className="absolute bottom-0 left-0 hidden h-[34%] w-[34%] text-light sm:block lg:h-[26%] lg:w-[30%]" />
      </div>
    </section>
  );
}
