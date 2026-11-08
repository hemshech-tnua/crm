import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Icon, type IconName } from './Icon';
import { EllipseRing } from './Ellipse';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────────── buttons ─────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  // brand book: earth-brown pill with cream type; outlined pill; orange (community) pill for the one highlighted call
  primary: 'bg-tide text-mist hover:bg-tide-deep active:bg-tide-deep disabled:bg-faint',
  secondary: 'bg-paper text-ink border border-ink/30 hover:border-ink hover:bg-sky-wash disabled:text-faint disabled:border-line',
  ghost: 'text-ink hover:bg-sky-wash disabled:text-faint',
  danger: 'bg-paper text-bad border border-bad/40 hover:bg-bad-wash disabled:text-faint',
  light: 'bg-light text-ink hover:bg-[#f0744f] disabled:bg-faint',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[0.95rem] gap-2',
  lg: 'h-14 px-6 text-lg gap-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return cx(
    'inline-flex items-center justify-center rounded-full font-semibold transition-colors select-none whitespace-nowrap',
    VARIANT[variant], SIZE[size], extra,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; icon?: IconName; busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, busy, className = '', children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner size={size === 'lg' ? 20 : 16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', icon, className = '', children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: IconName }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
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
    <button type="button" aria-label={label} title={label} className={cx('inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft hover:bg-mist-deep hover:text-ink', className)} {...rest}>
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
  'w-full rounded-[var(--radius-control)] border border-line bg-paper px-3.5 text-ink placeholder:text-faint transition-colors hover:border-ink-soft/50 focus:border-tide focus:outline-none focus:ring-3 focus:ring-tide/40 disabled:bg-mist disabled:text-muted aria-[invalid=true]:border-bad';

export function Field({ label, hint, error, children, htmlFor, required, className = '' }: {
  label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; required?: boolean; className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
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
      <legend className="mb-1.5 text-sm font-semibold">
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
                on ? 'border-tide bg-tide-wash text-tide-deep' : 'border-line bg-paper hover:border-ink-soft/40',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} aria-invalid={error ? true : undefined} className="h-5 w-5 accent-tide" />
              <span className="font-medium leading-snug">{o.label}</span>
            </label>
          );
        })}
      </div>
      {error && <p id={errId} className="flex items-center gap-1 text-sm font-medium text-bad"><Icon name="alert" size={15} />{error}</p>}
    </fieldset>
  );
}

/** 1–5 rating as five big buttons (radio semantics). */
export function Rating({ legend, value, onChange, required }: { legend: ReactNode; value: number | null; onChange: (v: number) => void; required?: boolean }) {
  const name = useId();
  const words = ['', 'חלש', 'בסדר', 'טוב', 'טוב מאוד', 'מצוין'];
  return (
    <fieldset>
      <legend className="mb-2 text-[0.95rem] font-semibold">
        {legend}
        {required && <span className="text-bad" aria-hidden="true"> *</span>}
      </legend>
      <div className="grid grid-cols-5 gap-2" dir="ltr">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <label key={n} className={cx(
              'flex h-14 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-control)] border transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-light',
              on ? 'border-light-deep bg-light text-ink' : 'border-line bg-paper hover:border-light-deep/60',
            )}>
              <input type="radio" name={name} value={n} checked={on} onChange={() => onChange(n)} className="sr-only" aria-label={`${n} – ${words[n]}`} />
              <span className="font-display text-xl leading-none">{n}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted"><span>מצוין</span><span>חלש</span></div>
    </fieldset>
  );
}

// ───────────── display ─────────────

type Tone = 'neutral' | 'tide' | 'light' | 'good' | 'bad' | 'warn' | 'ink';
const TONE: Record<Tone, string> = {
  neutral: 'bg-mist-deep text-ink-soft',
  tide: 'bg-tide-wash text-tide-deep',
  light: 'bg-light-wash text-light-deep',
  good: 'bg-good-wash text-good',
  bad: 'bg-bad-wash text-bad',
  warn: 'bg-warn-wash text-warn',
  ink: 'bg-ink text-mist',
};

export function Badge({ tone = 'neutral', children, icon, title }: { tone?: Tone; children: ReactNode; icon?: IconName; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold leading-6 whitespace-nowrap', TONE[tone])}>
      {icon && <Icon name={icon} size={13} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function Panel({ title, actions, children, className = '', padded = true, id }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; id?: string;
}) {
  return (
    <section id={id} className={cx('rounded-[var(--radius-panel)] border border-line-soft bg-paper', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 sm:px-5">
          {title && <h2 className="text-[1.05rem] font-bold">{title}</h2>}
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
          <Link to={back.to} className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-tide hover:underline">
            <Icon name="back" size={16} />
            {back.label}
          </Link>
        )}
        <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-[2rem]">{title}</h1>
        {subtitle && <div className="mt-1 text-[0.95rem] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon = 'sun', title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="relative mb-4 flex h-14 w-20 items-center justify-center text-ink">
        <EllipseRing className="absolute inset-0 h-full w-full text-light" weight={1.5} />
        <Icon name={icon} size={24} />
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
  const t = tone === 'tide' ? 'bg-tide-wash text-tide-deep' : tone === 'light' ? 'bg-light-wash text-ink' : 'bg-warn-wash text-warn';
  return (
    <div className={cx('flex items-start gap-2.5 rounded-[var(--radius-control)] px-3.5 py-3 text-sm leading-relaxed', t)}>
      <Icon name={icon} size={18} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

/** Tabs driven by a URL search param, so a tab can be linked and survives reload. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
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
              '-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-[3px] px-3 font-semibold transition-colors',
              on ? 'border-light text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count != null && <span className="num rounded-full bg-mist-deep px-1.5 text-xs font-bold text-ink-soft">{t.count}</span>}
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
