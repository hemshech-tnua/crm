import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Button, FilterChips, SearchInput, cx } from './kit';
import { SEARCH_PLACEHOLDER } from './search';

// One toolbar and one "no results" state for every list (participants, events, registrations, follow-ups…):
// search first, then the sort, then the chips under them, then a quiet line with the count.

export type ToolbarChip<T extends string> = { value: T; label: ReactNode; count?: number; title?: string };

/** "מיון": a compact select with its word, for the toolbar's sort. */
export function SortSelect<T extends string>({ options, value, onChange, label = 'מיון', className = '' }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string; className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('relative flex h-12 shrink-0 items-center rounded-[var(--radius-control)] border border-control-line bg-paper hover:border-ink focus-within:border-ink focus-within:ring-2 focus-within:ring-ink', className)}>
      <label htmlFor={id} className="ps-3 pe-1 text-small text-muted">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-full min-w-0 appearance-none bg-transparent ps-1 pe-8 font-medium text-ink focus:outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevron" size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 -rotate-90 text-muted" />
    </div>
  );
}

/**
 * The list toolbar. Every part is optional:
 *   search  — the box ("חיפוש לפי שם או טלפון" by default); pair it with matchesSearch() from '@/ui/search'
 *   sort    — a SortSelect next to the box
 *   chips   — FilterChips on their own row (the "all" chip is "הכול")
 *   extra   — anything else on the first row (a Segmented type filter, a "סינון" button…)
 *   summary — a quiet line under it all ("24 לוחמים", "3 מתוך 120"), read out when it changes
 */
export function ListToolbar<C extends string = string, S extends string = string>({ search, sort, chips, extra, summary, className = '' }: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; inputMode?: 'search' | 'text' | 'tel' | 'numeric' };
  sort?: { options: { value: S; label: string }[]; value: S; onChange: (v: S) => void; label?: string };
  chips?: { options: ToolbarChip<C>[]; value: C; onChange: (v: C) => void; label: string };
  extra?: ReactNode;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-4 flex flex-col gap-3', className)}>
      {(search || sort || extra) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <SearchInput
              className="min-w-0 flex-[1_1_16rem]"
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder ?? SEARCH_PLACEHOLDER}
              label={search.label ?? search.placeholder ?? SEARCH_PLACEHOLDER}
              inputMode={search.inputMode}
            />
          )}
          {sort && <SortSelect {...sort} />}
          {extra}
        </div>
      )}
      {chips && <FilterChips {...chips} />}
      {summary != null && <p className="text-small text-muted" aria-live="polite">{summary}</p>}
    </div>
  );
}

/**
 * Nothing matches the search or the filter: says so and offers one way back. Use it instead of EmptyState when the list
 * has rows but none pass (EmptyState stays for "there is nothing here yet").
 */
export function NoResults({ onClear, title = 'אין תוצאות לחיפוש הזה', clearLabel = 'ניקוי החיפוש והסינון', icon = 'search', children, className = '' }: {
  onClear?: () => void; title?: ReactNode; clearLabel?: string; icon?: IconName; children?: ReactNode; className?: string;
}) {
  return (
    <div role="status" className={cx('flex flex-col items-center px-4 py-10 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-panel)] border border-ink/25 text-ink-soft">
        <Icon name={icon} size={22} />
      </div>
      <p className="text-heading font-bold">{title}</p>
      {children && <div className="mt-1 max-w-md text-[0.95rem] text-muted">{children}</div>}
      {onClear && <Button variant="secondary" className="mt-4" onClick={onClear}>{clearLabel}</Button>}
    </div>
  );
}
