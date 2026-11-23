import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { DISMISS } from '@/lib/labels';
import type { EventType, PrepCategory, PrepKind, PrepTemplate } from '@/lib/types';
import { Button, EmptyState, ErrorBox, IconButton, Input, Notice, Panel, Segmented, Select, Skeleton, Textarea, cx } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { CATEGORY_LABEL, PREP_TYPE_LABEL, WEEKDAY_LETTER, WEEKDAY_NAME, fmtHours, hhmm, usePrepTemplates, weekLabel, whenText } from './shared';

const TYPES: EventType[] = ['friday', 'bonfire', 'other'];
const WEEKS = [-3, -2, -1, 0, 1, 2];

/** A small squared on/off switch. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={on ? 'פעיל' : 'כבוי'} onClick={() => onChange(!on)}
      className="inline-flex h-11 shrink-0 items-center gap-2 px-1 text-small focus-visible:outline-3 focus-visible:outline-ink">
      <span className={cx('relative h-6 w-10 rounded-[var(--radius-control)] border-2 transition-colors', on ? 'border-ink bg-ink' : 'border-control-line bg-paper')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-tag transition-all', on ? 'start-[18px] bg-light' : 'start-0.5 bg-control-line')} />
      </span>
      <span className={cx('hidden w-8 sm:inline', on ? 'font-semibold text-ink' : 'text-muted')}>{on ? 'פעיל' : 'כבוי'}</span>
    </button>
  );
}

/** The standing checklist per kind of meeting (Itai's "task warehouse"). */
export function TemplateView() {
  const q = usePrepTemplates();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const type: EventType = TYPES.includes(sp.get('type') as EventType) ? (sp.get('type') as EventType) : 'friday';
  const setType = (t: EventType) => setSp(t === 'friday' ? { tab: 'template' } : { tab: 'template', type: t }, { replace: true });
  const [editing, setEditing] = useState<PrepTemplate | { kind: PrepKind } | null>(null);

  const rows = useMemo(() => (q.data ?? []).filter((t) => t.event_type === type || t.event_type === 'all')
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'he')), [q.data, type]);

  const patch = useMutation({
    mutationFn: async (changes: { id: string; patch: Partial<PrepTemplate> }[]) => {
      for (const c of changes) {
        const { error } = await supabase.from('prep_templates').update(c.patch).eq('id', c.id);
        if (error) throw error;
      }
    },
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: ['prep_templates'] });
      const prev = qc.getQueryData<PrepTemplate[]>(['prep_templates']);
      qc.setQueryData<PrepTemplate[]>(['prep_templates'], (old) => old?.map((t) => ({ ...t, ...(changes.find((c) => c.id === t.id)?.patch ?? {}) })));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['prep_templates'], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['prep_templates'] }),
  });

  /** Move a row one place up or down among those shown: swap the two numbers, or renumber the list when they tie. */
  const move = (list: PrepTemplate[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i];
    const b = list[j];
    if (a.sort_order !== b.sort_order) {
      patch.mutate([{ id: a.id, patch: { sort_order: b.sort_order } }, { id: b.id, patch: { sort_order: a.sort_order } }]);
      return;
    }
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    const base = Math.min(...list.map((t) => t.sort_order));
    patch.mutate(next.map((t, k) => ({ id: t.id, patch: { sort_order: base + k * 10 } })).filter((c, k) => next[k].sort_order !== c.patch.sort_order));
  };

  const section = (kind: PrepKind) => {
    const list = rows.filter((t) => t.kind === kind);
    return (
      <Panel
        title={kind === 'task' ? 'משימות' : 'ציוד'}
        description={kind === 'task' ? `${list.filter((t) => t.is_active).length} משימות פעילות למפגש ${PREP_TYPE_LABEL[type]}` : 'מה אורזים. כל פריט הוא תיבה לסימון במפגש.'}
        actions={<Button size="sm" variant="secondary" icon="plus" onClick={() => setEditing({ kind })}>{kind === 'task' ? 'משימה חדשה' : 'פריט ציוד חדש'}</Button>}
        padded={false}
      >
        {!list.length ? <EmptyState icon="task" title="אין כאן עוד פריטים" /> : (
          <ol className="divide-y divide-edge" aria-label={kind === 'task' ? 'משימות בתבנית' : 'ציוד בתבנית'}>
            {list.map((t, i) => (
              <li key={t.id} className={cx('flex items-start gap-2 px-3 py-2 sm:items-center sm:px-4', !t.is_active && 'bg-mist/40')}>
                <div className="flex shrink-0 flex-col sm:flex-row">
                  <IconButton icon="chevron" label={`להזיז למעלה: ${t.title}`} className="rotate-90" disabled={i === 0} onClick={() => move(list, i, -1)} />
                  <IconButton icon="chevron" label={`להזיז למטה: ${t.title}`} className="-rotate-90" disabled={i === list.length - 1} onClick={() => move(list, i, 1)} />
                </div>
                <div className={cx('min-w-0 flex-1 py-1.5', !t.is_active && 'text-muted')}>
                  <p className={cx('leading-snug', t.is_active ? 'font-medium' : 'line-through decoration-ink/30')}>{t.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
                    {kind === 'task' && <span className="font-semibold text-ink-soft">{whenText(t)}</span>}
                    {t.fixed_time && <span className="num">{hhmm(t.fixed_time)}</span>}
                    {t.hours ? <span>{fmtHours(t.hours)}</span> : null}
                    {kind === 'task' && <span>{CATEGORY_LABEL[t.category]}</span>}
                    {t.event_type === 'all' && <span>לכל סוגי המפגשים</span>}
                  </p>
                  {t.notes && <p className="mt-0.5 text-small text-ink-soft">{t.notes}</p>}
                </div>
                <Switch on={t.is_active} label={`פעיל: ${t.title}`} onChange={(v) => patch.mutate([{ id: t.id, patch: { is_active: v } }])} />
                <IconButton icon="edit" label={`עריכה: ${t.title}`} onClick={() => setEditing(t)} />
              </li>
            ))}
          </ol>
        )}
      </Panel>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<EventType> label="סוג המפגש" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: PREP_TYPE_LABEL[t] }))} />
      </div>
      <Notice icon="task">
        שינוי בתבנית חל על מפגשים חדשים. מפגש שכבר קיים מקבל משימות שנוספו בכפתור "הוספה מהתבנית" בלשונית ההכנות שלו.
      </Notice>
      {q.isError && !q.data ? <ErrorBox error={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton shape="rows" count={8} height={64} /> : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {section('task')}
          {section('equipment')}
        </div>
      )}
      {editing && (
        <TemplateDialog
          template={'id' in editing ? editing : null}
          defaults={{ kind: editing.kind, event_type: type, sort_order: (Math.max(0, ...rows.filter((t) => t.kind === editing.kind).map((t) => t.sort_order)) || 0) + 10 }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateDialog({ template, defaults, onClose }: {
  template: PrepTemplate | null; defaults: { kind: PrepKind; event_type: EventType; sort_order: number }; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [initial] = useState(() => ({
    title: template?.title ?? '',
    kind: template?.kind ?? defaults.kind,
    event_type: template?.event_type ?? (defaults.kind === 'equipment' ? 'all' : defaults.event_type),
    category: template?.category ?? (defaults.kind === 'equipment' ? 'equipment' : 'general') as PrepCategory,
    mode: (template && template.weekday == null ? 'day' : 'week') as 'week' | 'day',
    week_offset: template?.week_offset ?? (defaults.kind === 'equipment' ? 0 : -1),
    weekday: template?.weekday ?? (defaults.kind === 'equipment' ? 4 : 2),
    day_offset: String(template?.day_offset ?? 0),
    fixed_time: hhmm(template?.fixed_time),
    hours: template?.hours != null ? String(Number(template.hours)) : '',
    notes: template?.notes ?? '',
    sort_order: String(template?.sort_order ?? defaults.sort_order),
    is_active: template?.is_active ?? true
  }));
  const [f, setF] = useState(initial);
  // a form dialog with typed changes ignores a tap outside, and asks before Escape or × close it
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const weeks = WEEKS.includes(f.week_offset) ? WEEKS : [...WEEKS, f.week_offset].sort((a, b) => a - b);
  const dayN = Number(f.day_offset);

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        title: f.title.trim(),
        kind: f.kind,
        event_type: f.event_type,
        category: f.kind === 'equipment' ? 'equipment' : f.category,
        week_offset: f.mode === 'week' ? f.week_offset : 0,
        weekday: f.mode === 'week' ? f.weekday : null,
        day_offset: f.mode === 'day' ? dayN : 0,
        fixed_time: f.fixed_time || null,
        hours: f.hours.trim() ? Number(f.hours) : null,
        notes: f.notes.trim() || null,
        sort_order: Number(f.sort_order) || 100,
        is_active: f.is_active,
      };
      const res = template ? await supabase.from('prep_templates').update(row).eq('id', template.id) : await supabase.from('prep_templates').insert(row);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prep_templates'] });
      toast.success(template ? 'נשמר בתבנית' : 'נוסף לתבנית');
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const h = f.hours.trim() ? Number(f.hours) : null;
    const next = {
      title: f.title.trim().length < 2 ? 'צריך לכתוב מה המשימה.' : f.title.trim().length > 120 ? 'עד 120 תווים.' : null,
      hours: h != null && (Number.isNaN(h) || h < 0 || h > 24) ? 'מספר שעות בין 0 ל־24 (למשל 0.5).' : null,
      day_offset: f.mode === 'day' && (!Number.isInteger(dayN) || dayN < -60 || dayN > 30) ? 'צריך מספר ימים בין ‎-60 (לפני המפגש) ל־30 (אחריו).' : null,
      sort_order: !Number.isInteger(Number(f.sort_order)) ? 'צריך מספר שלם.' : null,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!dirty}
      title={template ? 'עריכה בתבנית' : f.kind === 'task' ? 'משימה חדשה בתבנית' : 'פריט ציוד חדש בתבנית'}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label={f.kind === 'task' ? 'מה צריך לעשות' : 'הפריט'} required value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} maxLength={120} autoFocus={!template} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium">סוג</span>
            <Segmented<PrepKind> label="סוג" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'task', label: 'משימה' }, { value: 'equipment', label: 'ציוד' }]} />
          </div>
          <Select label="לאילו מפגשים" value={f.event_type} onChange={(e) => set('event_type', e.target.value as PrepTemplate['event_type'])}>
            {(['friday', 'bonfire', 'other', 'all'] as const).map((t) => <option key={t} value={t}>{t === 'all' ? 'לכל סוגי המפגשים' : `מפגש ${PREP_TYPE_LABEL[t]}`}</option>)}
          </Select>
        </div>
        {f.kind === 'task' && (
          <Select label="תחום" value={f.category} onChange={(e) => set('category', e.target.value as PrepCategory)}>
            {(Object.keys(CATEGORY_LABEL) as PrepCategory[]).filter((c) => c !== 'equipment' || f.category === 'equipment').map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        )}

        <fieldset className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-edge p-3.5">
          <legend className="px-1 text-small font-medium">מתי</legend>
          <Segmented<'week' | 'day'> label="איך קובעים את המועד" value={f.mode} onChange={(v) => set('mode', v)}
            options={[{ value: 'week', label: 'יום בשבוע' }, { value: 'day', label: 'לפי יום המפגש' }]} />
          {f.mode === 'week' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="שבוע" value={f.week_offset} onChange={(e) => set('week_offset', Number(e.target.value))}>
                {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
              </Select>
              <Select label="יום" value={f.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
                {WEEKDAY_NAME.map((n, i) => <option key={i} value={i}>{i === 6 ? 'שבת' : `יום ${n} (${WEEKDAY_LETTER[i]})`}</option>)}
              </Select>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <span className="pb-3 font-medium whitespace-nowrap">ביום המפגש +</span>
              <Input label="ימים" type="number" inputMode="numeric" min={-60} max={30} step={1} value={f.day_offset} onChange={(e) => set('day_offset', e.target.value)} error={errors.day_offset} className="w-24" />
            </div>
          )}
          <p className="flex items-center gap-1.5 text-small text-ink-soft">
            <Icon name="calendar" size={16} />
            {f.mode === 'week' ? whenText({ week_offset: f.week_offset, weekday: f.weekday, day_offset: 0 }) : Number.isInteger(dayN) ? whenText({ week_offset: 0, weekday: null, day_offset: dayN }) : '—'}
            {f.mode === 'week' && <span className="text-muted">(השבוע מתחיל ביום א׳)</span>}
          </p>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <Input label="שעה קבועה" type="time" value={f.fixed_time} onChange={(e) => set('fixed_time', e.target.value)} />
          <Input label="שעות" type="number" inputMode="decimal" min={0} max={24} step={0.25} value={f.hours} onChange={(e) => set('hours', e.target.value)} error={errors.hours} />
          <Input label="מספר סדר" type="number" inputMode="numeric" step={10} value={f.sort_order} onChange={(e) => set('sort_order', e.target.value)} error={errors.sort_order} />
        </div>
        <Textarea label="הערות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} rows={2} />
        <div className="flex items-center gap-2">
          <Switch on={f.is_active} onChange={(v) => set('is_active', v)} label="פעיל בתבנית" />
          <span className="text-small text-muted">פריט כבוי לא נכנס למפגשים חדשים</span>
        </div>
        {formError && <p className="text-small font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
