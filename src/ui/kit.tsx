import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Icon, type IconName } from './Icon';
import { Stripes, Tri } from './Shapes';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────────── buttons ─────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light' | 'onDark';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  // brand book: a squared navy button with beige type (and the triangle ◀ on a call to action); outlined navy; beige on navy
  primary: 'bg-tide text-light hover:bg-ink-soft active:bg-tide-deep disabled:bg-tide/40 disabled:text-light/80',
  secondary: 'bg-transparent text-ink border border-control-line hover:border-ink hover:bg-ink/[0.06] active:bg-ink/10 disabled:text-ink/45 disabled:border-ink/25',
  ghost: 'text-ink hover:bg-ink/[0.06] active:bg-ink/10 disabled:text-faint',
  danger: 'bg-transparent text-bad border border-bad hover:bg-bad-wash disabled:text-faint disabled:border-line',
  light: 'bg-light text-ink hover:bg-[#f4e9cf] disabled:bg-light/50',
  /** outlined beige, for secondary actions on a navy area (the dashboard band, the door header) */
  onDark: 'border border-light/60 text-light hover:bg-light/10 active:bg-light/15 disabled:text-light/50',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 pointer-coarse:h-11 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[0.95rem] gap-2',
  lg: 'h-14 px-6 text-lg gap-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return cx(
    'inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold transition-colors select-none whitespace-nowrap',
    VARIANT[variant], SIZE[size], extra,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; icon?: IconName; busy?: boolean;
  /** the brand's call-to-action mark: a triangle ◀ after the label, pointing the way forward */
  cta?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, busy, cta, className = '', children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner size={size === 'lg' ? 20 : 16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
      {cta && !busy && <Tri className="ms-1" />}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', icon, cta, className = '', children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: IconName; cta?: boolean }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
      {cta && <Tri className="ms-1" />}
    </Link>
  );
}

export function ExternalButton({ href, variant = 'secondary', size = 'md', icon, className = '', children, label }: {
  href: string; variant?: Variant; size?: Size; icon?: IconName; className?: string; children?: ReactNode; label?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size, className)} aria-label={label}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </a>
  );
}

export function IconButton({ icon, label, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-ink/[0.07] hover:text-ink', className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ───────────── form fields ─────────────

const controlBase =
  'w-full rounded-[var(--radius-control)] border border-control-line bg-paper px-3.5 text-ink placeholder:text-faint transition-colors hover:border-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink disabled:border-line disabled:bg-mist disabled:text-muted aria-[invalid=true]:border-bad aria-[invalid=true]:focus:ring-bad';

export function Field({ label, hint, error, children, htmlFor, required, className = '' }: {
  label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; required?: boolean; className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-small font-medium text-ink">
        {label}
        {required && <span className="text-bad" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-sm text-muted">{hint}</p>}
      {error && <p id={htmlFor ? `${htmlFor}-err` : undefined} className="flex items-center gap-1 text-sm font-medium text-bad"><Icon name="alert" size={15} />{error}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; ltr?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, ltr, className = '', id, required, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const input = (
    <input
      ref={ref}
      id={fid}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={label ? (error ? `${fid}-err` : hint ? `${fid}-hint` : undefined) : undefined}
      dir={ltr ? 'ltr' : undefined}
      className={cx(controlBase, 'h-12', ltr && 'text-left', className)}
      {...rest}
    />
  );
  return label ? <Field label={label} hint={hint} error={error} htmlFor={fid} required={required}>{input}</Field> : input;
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, className = '', id, children, required, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const el = (
    <select ref={ref} id={fid} required={required} aria-invalid={error ? true : undefined}
      aria-describedby={label ? (error ? `${fid}-err` : hint ? `${fid}-hint` : undefined) : undefined} className={cx(controlBase, 'h-12 pl-8', className)} {...rest}>
      {children}
    </select>
  );
  return label ? <Field label={label} hint={hint} error={error} htmlFor={fid} required={required}>{el}</Field> : el;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, error, className = '', id, required, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const el = (
    <textarea ref={ref} id={fid} required={required} aria-invalid={error ? true : undefined}
      aria-describedby={label ? (error ? `${fid}-err` : hint ? `${fid}-hint` : undefined) : undefined} className={cx(controlBase, 'min-h-24 py-2.5 leading-relaxed', className)} {...rest} />
  );
  return label ? <Field label={label} hint={hint} error={error} htmlFor={fid} required={required}>{el}</Field> : el;
});

export function Checkbox({ label, hint, checked, onChange, disabled, name }: {
  label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer rounded-md border-line accent-tide"
      />
      <label htmlFor={id} className="cursor-pointer leading-snug">
        <span className="text-[0.95rem]">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      </label>
    </div>
  );
}

/** Large tappable choices (sources, ratings) instead of a dropdown on phones. */
export function ChoiceGroup<T extends string>({ legend, options, value, onChange, error, columns = 2, required }: {
  legend: ReactNode; options: { value: T; label: ReactNode }[]; value: T | ''; onChange: (v: T) => void; error?: string | null; columns?: 1 | 2 | 3; required?: boolean;
}) {
  const name = useId();
  const errId = `${name}-err`;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errId : undefined}>
      <legend className="mb-1.5 text-small font-medium">
        {legend}
        {required && <span className="text-bad" aria-hidden="true"> *</span>}
      </legend>
      <div className={cx('grid gap-2', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={cx(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3.5 py-2.5 transition-colors',
                // selected is told by a 2px navy frame and weight, not by colour alone
                on ? 'border-2 border-ink bg-paper px-[13px] py-[9px] font-semibold text-ink' : 'border-control-line bg-paper hover:border-ink',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} aria-invalid={error ? true : undefined} className="h-5 w-5 accent-tide" />
              <span className="leading-snug">{o.label}</span>
            </label>
          );
        })}
      </div>
      {error && <p id={errId} className="flex items-center gap-1 text-sm font-medium text-bad"><Icon name="alert" size={15} />{error}</p>}
    </fieldset>
  );
}

/** 1–5 rating as five big buttons (radio semantics). */
export function Rating({ legend, value, onChange, required, error }: { legend: ReactNode; value: number | null; onChange: (v: number) => void; required?: boolean; error?: string | null }) {
  const name = useId();
  const errId = `${name}-err`;
  const words = ['', 'חלש', 'בסדר', 'טוב', 'טוב מאוד', 'מצוין'];
  return (
    <fieldset aria-describedby={error ? errId : undefined}>
      <legend className="mb-2 text-[0.95rem] font-semibold">
        {legend}
        {required && <span className="text-bad" aria-hidden="true"> *</span>}
      </legend>
      <div className="grid grid-cols-5 gap-2" dir="ltr">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <label key={n} className={cx(
              'flex h-14 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-control)] border transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
              on ? 'border-ink bg-ink text-light' : error ? 'border-bad bg-paper' : 'border-control-line bg-paper hover:border-ink',
            )}>
              <input type="radio" name={name} value={n} checked={on} onChange={() => onChange(n)} className="sr-only" aria-label={`${n} – ${words[n]}`} aria-invalid={error ? true : undefined} />
              <span className="font-display text-xl leading-none">{n}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted"><span>מצוין</span><span>חלש</span></div>
      {error && <p id={errId} className="mt-1.5 flex items-center gap-1 text-sm font-medium text-bad"><Icon name="alert" size={15} />{error}</p>}
    </fieldset>
  );
}

// ───────────── display ─────────────

type Tone = 'neutral' | 'tide' | 'light' | 'good' | 'bad' | 'warn' | 'ink';
// Tones must be told apart at a glance: outline (neutral/tide), filled beige, filled navy, and the three status tones
// with a ring (warn and bad also carry the alert icon where they are used).
const TONE: Record<Tone, string> = {
  neutral: 'border border-ink/25 text-ink-soft',
  tide: 'border border-ink/40 text-ink',
  light: 'bg-light text-ink',
  good: 'bg-good-wash text-good ring-1 ring-inset ring-good/30',
  bad: 'bg-bad-wash text-bad ring-1 ring-inset ring-bad/30',
  warn: 'bg-warn-wash text-warn ring-1 ring-inset ring-warn/40',
  ink: 'bg-ink text-light',
};

export function Badge({ tone = 'neutral', children, icon, title }: { tone?: Tone; children: ReactNode; icon?: IconName; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-6 items-center gap-1 rounded-[2px] px-1.5 text-xs font-medium whitespace-nowrap', TONE[tone])}>
      {icon && <Icon name={icon} size={13} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function Panel({ title, description, actions, children, className = '', padded = true, id }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; id?: string;
}) {
  return (
    <section id={id} className={cx('rounded-[var(--radius-panel)] border border-edge bg-paper', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3 sm:px-5">
          {title && (
            <div className="min-w-0">
              <h2 className="text-heading font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-small text-muted">{description}</p>}
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4 sm:p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-tide hover:underline">
            <Icon name="back" size={16} />
            {back.label}
          </Link>
        )}
        <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-title">{title}</h1>
        {subtitle && <div className="mt-1 text-[0.95rem] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon = 'sun', title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      {/* a navy tile, the icon above a run of beige stripes cut by the tile's bottom edge */}
      <div className="relative mb-4 flex h-20 w-20 items-start justify-center overflow-hidden rounded-[var(--radius-panel)] bg-ink pt-4 text-light">
        <Icon name={icon} size={26} />
        <Stripes width={80} height={26} unit={12} dir="fall" count={3} offset={8} className="absolute inset-x-0 bottom-0 h-[26px] w-20" />
      </div>
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mt-1 max-w-md text-[0.95rem] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3', className)} role="status" aria-busy="true" aria-label="טוען">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-5" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-bad/30 bg-bad-wash px-4 py-3 text-bad">
      <Icon name="alert" />
      <span className="flex-1 font-medium">{error}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>לנסות שוב</Button>}
    </div>
  );
}

export function Notice({ tone = 'tide', icon = 'shield', children }: { tone?: 'tide' | 'light' | 'warn'; icon?: IconName; children: ReactNode }) {
  // on the beige ground a beige box disappears: notices are warm-white cards with a coloured edge on the start side
  const t = tone === 'tide' ? 'bg-paper text-ink border-ink' : tone === 'light' ? 'bg-paper text-ink border-ink/40' : 'bg-warn-wash text-warn border-warn';
  return (
    <div className={cx('flex items-start gap-2.5 rounded-[var(--radius-control)] border-s-[3px] px-3.5 py-3 text-sm leading-relaxed', t)}>
      <Icon name={icon} size={18} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

/** Tabs driven by a URL search param, so a tab can be linked and survives reload. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 [mask-image:linear-gradient(to_right,transparent,#000_28px)] sm:mx-0 sm:px-0 sm:[mask-image:none]">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cx(
              '-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-[3px] px-2.5 font-semibold transition-colors sm:px-3',
              on ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count != null && <span className={cx('num rounded-[2px] px-1.5 text-xs font-bold', on ? 'bg-ink text-light' : 'bg-mist-deep text-ink-soft')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2.5 text-[0.95rem]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words font-medium">{v ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative">
      <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-faint" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(controlBase, 'h-12 pr-10')}
      />
    </div>
  );
}

// ───────────── shared controls (one look for every filter, segment and table) ─────────────

/** A segmented control: one choice out of a few (periods, kinds). Radio semantics via aria-pressed buttons. */
export function Segmented<T extends string>({ options, value, onChange, label, className = '' }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex rounded-[var(--radius-control)] border border-edge bg-paper p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'h-10 pointer-coarse:h-11 shrink-0 rounded-[2px] px-3 text-small font-medium transition-colors',
              on ? 'bg-ink text-light' : 'text-ink-soft hover:bg-ink/[0.05] hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Filter chips: a row of toggles with optional counts (participants, registrations, follow-ups). */
export function FilterChips<T extends string>({ options, value, onChange, label, className = '' }: {
  options: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex h-10 pointer-coarse:h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-small font-medium transition-colors',
              on ? 'border-ink bg-ink text-light' : 'border-control-line text-ink-soft hover:border-ink hover:text-ink',
            )}
          >
            {o.label}
            {o.count != null && <span className={cx('num text-micro', on ? 'text-light/75' : 'text-muted')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Data tables: one wrapper, header and cell style everywhere. Numeric columns: `numeric` (left-aligned, tabular). */
export function Table({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-[var(--radius-panel)] border border-edge bg-paper', className)}>
      <table className="w-full border-collapse text-body" aria-label={label}>{children}</table>
    </div>
  );
}
export function Th({ children, numeric, className = '' }: { children?: ReactNode; numeric?: boolean; className?: string }) {
  return (
    <th scope="col" className={cx('h-10 bg-mist/70 px-3 text-micro font-medium text-muted first:ps-4 last:pe-4', numeric ? 'text-left' : 'text-right', className)}>
      {children}
    </th>
  );
}
export function Td({ children, numeric, className = '' }: { children?: ReactNode; numeric?: boolean; className?: string }) {
  return (
    <td className={cx('h-12 border-t border-edge px-3 py-2 first:ps-4 last:pe-4', numeric && 'num text-left', className)}>
      {children}
    </td>
  );
}

