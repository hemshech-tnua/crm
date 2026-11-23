import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { normalizePhone, PHONE_EXAMPLE } from '@/lib/phone';
import { useSettings, useSites, useStaffList } from '@/lib/data';
import type { Settings } from '@/lib/types';
import { useUnsavedGuard } from '@/lib/unsaved';
import { Button, Checkbox, ErrorBox, Input, Panel, Select, Skeleton, cx } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { useHideTabBar } from '@/ui/chrome';

type Form = Record<keyof Settings, string | boolean | null>;

const PERCENT_KEYS = ['goal_show_rate', 'goal_return_rate', 'goal_friend_share'] as const;
const same = (a: Form, b: Form) => (Object.keys(b) as (keyof Settings)[]).every((k) => (a[k] ?? '') === (b[k] ?? ''));

export function GeneralSettings() {
  const settings = useSettings();
  const sites = useSites();
  const staff = useStaffList();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Form | null>(null);
  // the saved values as a form: what "dirty" compares with
  const [base, setBase] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  // after a save the form takes the stored values (the server may tidy them, e.g. the phone)
  const resync = useRef(false);

  useEffect(() => {
    if (!settings.data) return;
    const s = settings.data as unknown as Record<string, unknown>;
    const out: Record<string, string | boolean | null> = {};
    for (const [k, v] of Object.entries(s)) {
      out[k] = typeof v === 'boolean' ? v : v == null ? '' : (PERCENT_KEYS as readonly string[]).includes(k) ? String(Math.round(Number(v) * 100)) : String(v);
    }
    // a refresh in the background never overwrites what is being typed: the form follows only while it is unchanged
    const take = resync.current;
    resync.current = false;
    setF((cur) => (!cur || !base || take || same(cur, base) ? (out as Form) : cur));
    setBase(out as Form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const { error: err } = await supabase.from('settings').update(patch).eq('id', true);
      if (err) throw err;
    },
    onSuccess: () => {
      resync.current = true;
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['kpis'] });
      toast.success('ההגדרות נשמרו');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const dirty = !!f && !!base && !same(f, base);
  useUnsavedGuard(dirty && !save.isPending, { search: true });
  // a phone shows the save bar at the bottom (in reach of the thumb) once something changed, in place of the tab bar
  useHideTabBar(dirty);

  if (!f) return settings.error ? <ErrorBox error={errorMessage(settings.error)} onRetry={() => void settings.refetch()} /> : <Skeleton shape="tiles" count={4} height={200} cols="grid-cols-1" />;

  const str = (k: keyof Settings) => (f[k] as string) ?? '';
  const bind = (k: keyof Settings) => ({ value: str(k), onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const int = (k: keyof Settings) => Number(str(k));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const patch: Partial<Settings> = {
      org_name: str('org_name').trim(),
      default_site_id: str('default_site_id') || null,
      default_capacity: str('default_capacity') ? int('default_capacity') : null,
      goal_avg_attendance: int('goal_avg_attendance'),
      goal_show_rate: int('goal_show_rate') / 100,
      goal_return_rate: int('goal_return_rate') / 100,
      goal_friend_share: int('goal_friend_share') / 100,
      goal_avg_rating: Number(str('goal_avg_rating')),
      regular_min_fridays: int('regular_min_fridays'),
      regular_window_days: int('regular_window_days'),
      lapsed_after_fridays: int('lapsed_after_fridays'),
      auto_task_no_show: f.auto_task_no_show as boolean,
      auto_task_first_time: f.auto_task_first_time as boolean,
      auto_task_lapsed: f.auto_task_lapsed as boolean,
      default_task_assignee: str('default_task_assignee') || null,
      checkin_opens_minutes: int('checkin_opens_minutes'),
      checkin_closes_minutes: int('checkin_closes_minutes'),
      feedback_days: int('feedback_days'),
      retention_months: int('retention_months'),
      contact_phone: str('contact_phone').trim() || null,
    };
    const pcts = [patch.goal_show_rate, patch.goal_return_rate, patch.goal_friend_share];
    if (pcts.some((p) => p == null || Number.isNaN(p) || p < 0 || p > 1)) return setError('יעדי האחוזים צריכים להיות בין 0 ל־100.');
    if (!(patch.goal_avg_rating! >= 1 && patch.goal_avg_rating! <= 5)) return setError('יעד הדירוג צריך להיות בין 1 ל־5.');
    if (patch.contact_phone && !normalizePhone(patch.contact_phone)) return setError(`מספר הטלפון של הצוות לא תקין. למשל ${PHONE_EXAMPLE}.`);
    save.mutate(patch);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Panel title="היעדים לשנה">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="ממוצע לוחמים למפגש" type="number" min={0} inputMode="numeric" {...bind('goal_avg_attendance')} />
          <Input label="שיעור הגעה מתוך הנרשמים (%)" type="number" min={0} max={100} {...bind('goal_show_rate')} />
          <Input label="הגיעו ליותר ממפגש אחד (%)" type="number" min={0} max={100} {...bind('goal_return_rate')} />
          <Input label="חדשים שהגיעו דרך חבר (%)" type="number" min={0} max={100} {...bind('goal_friend_share')} />
          <Input label="דירוג ממוצע (1–5)" type="number" min={1} max={5} step={0.1} {...bind('goal_avg_rating')} />
        </div>
      </Panel>

      <Panel title="מתי לוחם נחשב קבוע, ומתי הפסיק להגיע">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="מפגשי שישי לפחות" type="number" min={1} max={10} {...bind('regular_min_fridays')} />
          <Input label="בתוך כמה ימים" type="number" min={7} max={120} {...bind('regular_window_days')} hint="ברירת מחדל: 2 מפגשי שישי ב־30 יום" />
          <Input label="התראה אחרי כמה מפגשי שישי בלי הגעה" type="number" min={1} max={12} {...bind('lapsed_after_fridays')} />
        </div>
      </Panel>

      <Panel title="משימות מעקב אוטומטיות בסגירת מפגש">
        <div className="flex flex-col gap-4">
          <Checkbox checked={!!f.auto_task_no_show} onChange={(v) => setF({ ...f, auto_task_no_show: v })} label='מי שנרשם ולא הגיע: "חסרת לנו" ושיחה' />
          <Checkbox checked={!!f.auto_task_first_time} onChange={(v) => setF({ ...f, auto_task_first_time: v })} label="מי שהגיע בפעם הראשונה: שיחת היכרות ותודה" />
          <Checkbox checked={!!f.auto_task_lapsed} onChange={(v) => setF({ ...f, auto_task_lapsed: v })} label="קבוע שהפסיק להגיע: לשאול מה נשמע" hint="המשימה רק מזכירה. שום הודעה לא נשלחת בלי שמישהו בצוות לוחץ שליחה." />
          <Select label="מי אחראי על המשימות" value={str('default_task_assignee')} onChange={(e) => setF({ ...f, default_task_assignee: e.target.value })} className="max-w-sm">
            <option value="">בלי אחראי (כל הצוות רואה)</option>
            {(staff.data ?? []).filter((s) => s.is_active && s.role !== 'volunteer').map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
          </Select>
        </div>
      </Panel>

      <Panel title="מפגשים והרשמה">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="שם העמותה" {...bind('org_name')} />
          <Input label="טלפון הצוות לשיחות ולוואטסאפ (מוצג ללוחמים)" type="tel" ltr {...bind('contact_phone')} hint="לפניות, ביטול בלי הקישור ובקשות פרטיות" />
          <Select label="מתחם ברירת מחדל" {...bind('default_site_id')}>
            {(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="מספר מקומות (ברירת מחדל)" type="number" min={1} {...bind('default_capacity')} />
          <Input label="צ׳ק־אין נפתח (דקות לפני תחילת המפגש)" type="number" min={0} max={720} {...bind('checkin_opens_minutes')} />
          <Input label="צ׳ק־אין נסגר (דקות אחרי הסיום)" type="number" min={0} max={1440} {...bind('checkin_closes_minutes')} />
          <Input label="אפשר לתת משוב עד (ימים אחרי המפגש)" type="number" min={1} max={60} {...bind('feedback_days')} />
          <Input label="שמירת מידע: חודשים בלי פעילות עד הצעה להתממה" type="number" min={6} max={120} {...bind('retention_months')} />
        </div>
      </Panel>

      {error && <ErrorBox error={error} />}
      {/* wide screens: the save button sticks to the bottom of the window, so it stays next to the field being changed;
          a phone gets it in a bar fixed at the bottom once something changed (and at the end of the form otherwise).
          Before any change it stays in place at the end, disabled */}
      <div className={cx('flex items-center gap-3 max-md:hidden', dirty && 'sticky bottom-0 z-10 -mx-1 border-t border-edge bg-sky px-1 py-3')}>
        <Button type="submit" size="lg" busy={save.isPending} disabled={!dirty && !save.isPending}>שמירת ההגדרות</Button>
        <span className="text-small text-muted" aria-live="polite">{dirty ? 'יש שינויים שעוד לא נשמרו.' : 'אין שינויים לשמירה.'}</span>
      </div>
      {!dirty && <div className="md:hidden"><Button type="submit" size="lg" disabled>שמירת ההגדרות</Button></div>}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-edge bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <Button type="submit" busy={save.isPending} icon="check" className="flex-1">שמירת ההגדרות</Button>
        </div>
      )}
    </form>
  );
}
