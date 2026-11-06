import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useEvent, useSettings, useSites, useSpeakers, useEventsWithStats } from '@/lib/data';
import { errorMessage } from '@/lib/errors';
import { addDays, fmtDayLong, fromIl, ilParts, nextFriday, todayIl } from '@/lib/dates';
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '@/lib/labels';
import type { EventRow, EventStatus, EventType, Settings, Site, Speaker } from '@/lib/types';
import { Button, ButtonLink, ChoiceGroup, ErrorBox, Input, Notice, PageHeader, Panel, Select, Skeleton, Textarea, Checkbox, cx } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { DEFAULT_TIMES, DEFAULT_TITLE, useInvalidateEvent } from './queries';
import { StatusBadge, hasStarted } from './shared';

type Form = {
  type: EventType;
  title: string;
  date: string;
  start: string;
  end: string;
  site_id: string;
  location: string;
  capacity: string;
  waitlist_enabled: boolean;
  closes_early: boolean;
  closes_date: string;
  closes_time: string;
  activity_name: string;
  instructor_id: string;
  speaker_id: string;
  lecture_topic: string;
  description: string;
  internal_notes: string;
  status: EventStatus;
};
type Errors = Partial<Record<keyof Form | 'form', string>>;

const ACTIVITY_SUGGESTIONS = ['יוגה', 'פילאטיס', 'יוגה ופילאטיס', 'יוגה עדינה'];

/** The coming Friday at 09:00 that has not started yet. */
function defaultFriday(): string {
  const d = nextFriday(todayIl());
  return new Date(fromIl(d, DEFAULT_TIMES.friday[0])).getTime() > Date.now() ? d : addDays(d, 7);
}

function newForm(settings: Settings | undefined, sites: Site[], taken: Set<string>): Form {
  const siteId = settings?.default_site_id ?? sites.find((s) => s.is_active)?.id ?? '';
  // S12: the first coming Friday that does not have a Friday meeting yet
  let date = defaultFriday();
  for (let i = 0; i < 12 && taken.has(date); i++) date = addDays(date, 7);
  return {
    type: 'friday',
    title: DEFAULT_TITLE.friday,
    date,
    start: DEFAULT_TIMES.friday[0],
    end: DEFAULT_TIMES.friday[1],
    site_id: siteId,
    location: sites.find((s) => s.id === siteId)?.address ?? '',
    capacity: settings?.default_capacity ? String(settings.default_capacity) : '',
    waitlist_enabled: true,
    closes_early: false,
    closes_date: addDays(date, -1),
    closes_time: '20:00',
    activity_name: 'יוגה',
    instructor_id: '',
    speaker_id: '',
    lecture_topic: '',
    description: '',
    internal_notes: '',
    status: 'draft',
  };
}

function formFromEvent(e: EventRow): Form {
  const s = ilParts(e.starts_at);
  const en = ilParts(e.ends_at);
  const c = e.registration_closes_at ? ilParts(e.registration_closes_at) : null;
  return {
    type: e.type,
    title: e.title,
    date: s.date,
    start: s.time,
    end: en.time,
    site_id: e.site_id,
    location: e.location ?? '',
    capacity: e.capacity != null ? String(e.capacity) : '',
    waitlist_enabled: e.waitlist_enabled,
    closes_early: !!c,
    closes_date: c?.date ?? addDays(s.date, -1),
    closes_time: c?.time ?? '20:00',
    activity_name: e.activity_name ?? '',
    instructor_id: e.instructor_id ?? '',
    speaker_id: e.speaker_id ?? '',
    lecture_topic: e.lecture_topic ?? '',
    description: e.description ?? '',
    internal_notes: e.internal_notes ?? '',
    status: e.status,
  };
}

export function EventEditPage() {
  const { id } = useParams();
  const event = useEvent(id);
  const settings = useSettings();
  const sites = useSites();
  const speakers = useSpeakers();
  // a stable key (today's date): a key built from the current time would refetch forever
  const upcoming = useEventsWithStats({ from: fromIl(todayIl(), '00:00'), ascending: true });
  const takenFridays = new Set((upcoming.data ?? []).filter((e) => e.type === 'friday' && e.status !== 'cancelled').map((e) => ilParts(e.starts_at).date));

  const loading = (id && event.isLoading) || settings.isLoading || sites.isLoading || speakers.isLoading || (!id && upcoming.isLoading);
  const error = (id && event.error) || sites.error || speakers.error;

  return (
    <>
      <PageHeader
        title={id ? 'עריכת מפגש' : 'מפגש חדש'}
        back={id ? { to: `/app/events/${id}`, label: 'חזרה למפגש' } : { to: '/app/events', label: 'כל המפגשים' }}
      />
      {loading ? (
        <Panel><Skeleton lines={8} /></Panel>
      ) : error ? (
        <ErrorBox error={errorMessage(error)} onRetry={() => { event.refetch(); sites.refetch(); speakers.refetch(); }} />
      ) : (
        <EventForm
          key={id ?? 'new'}
          event={id ? event.data : undefined}
          initial={id && event.data ? formFromEvent(event.data) : newForm(settings.data, sites.data ?? [], takenFridays)}
          sites={sites.data ?? []}
          speakers={speakers.data ?? []}
        />
      )}
    </>
  );
}

function validate(f: Form): { errors: Errors; starts?: string; ends?: string; closes?: string | null } {
  const errors: Errors = {};
  const title = f.title.trim();
  if (title.length < 2 || title.length > 120) errors.title = 'צריך כותרת (2 עד 120 תווים).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errors.date = 'צריך לבחור תאריך.';
  if (!/^\d{2}:\d{2}$/.test(f.start)) errors.start = 'צריך שעת התחלה.';
  if (!/^\d{2}:\d{2}$/.test(f.end)) errors.end = 'צריך שעת סיום.';
  if (!f.site_id) errors.site_id = 'צריך לבחור מתחם.';
  if (f.location.length > 200) errors.location = 'עד 200 תווים.';
  if (f.capacity.trim() !== '') {
    const n = Number(f.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 1000) errors.capacity = 'מספר שלם בין 1 ל-1000, או ריק בלי הגבלה.';
  }
  if (f.activity_name.length > 60) errors.activity_name = 'עד 60 תווים.';
  if (f.lecture_topic.length > 160) errors.lecture_topic = 'עד 160 תווים.';
  if (f.description.length > 2000) errors.description = 'עד 2000 תווים.';
  if (f.internal_notes.length > 2000) errors.internal_notes = 'עד 2000 תווים.';
  if (errors.date || errors.start || errors.end) return { errors };

  const starts = fromIl(f.date, f.start);
  const ends = fromIl(f.date, f.end);
  if (new Date(ends) <= new Date(starts)) errors.end = 'שעת הסיום צריכה להיות אחרי שעת ההתחלה.';
  let closes: string | null = null;
  if (f.closes_early) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.closes_date) || !/^\d{2}:\d{2}$/.test(f.closes_time)) {
      errors.closes_date = 'צריך תאריך ושעה לסגירת ההרשמה.';
    } else {
      closes = fromIl(f.closes_date, f.closes_time);
      if (new Date(closes) > new Date(ends)) errors.closes_date = 'ההרשמה צריכה להיסגר לפני שהמפגש נגמר.';
    }
  }
  return Object.keys(errors).length ? { errors } : { errors, starts, ends, closes };
}

function EventForm({ event, initial, sites, speakers }: { event?: EventRow; initial: Form; sites: Site[]; speakers: Speaker[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateEvent();
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const instructors = useMemo(
    () => speakers.filter((s) => s.kind === 'instructor' && (s.status === 'approved' || s.id === initial.instructor_id)),
    [speakers, initial.instructor_id],
  );
  const lecturers = useMemo(
    () => speakers.filter((s) => s.kind === 'speaker' && (s.status === 'approved' || s.status === 'proposed' || s.id === initial.speaker_id)),
    [speakers, initial.speaker_id],
  );
  const speaker = speakers.find((s) => s.id === f.speaker_id);
  const lockedStatus = f.status === 'completed' || f.status === 'cancelled';

  const changeType = (t: EventType) => {
    setF((p) => {
      const next = { ...p, type: t };
      if (!p.title.trim() || p.title === DEFAULT_TITLE[p.type]) next.title = DEFAULT_TITLE[t];
      const [s0, e0] = DEFAULT_TIMES[p.type];
      if (p.start === s0 && p.end === e0) [next.start, next.end] = DEFAULT_TIMES[t];
      if (t !== 'friday' && p.activity_name === 'יוגה' && !event) next.activity_name = '';
      if (t === 'friday' && !p.activity_name && !event) next.activity_name = 'יוגה';
      return next;
    });
  };

  const changeSite = (id: string) => {
    setF((p) => {
      const prev = sites.find((s) => s.id === p.site_id);
      const nextSite = sites.find((s) => s.id === id);
      const keepLocation = p.location.trim() && p.location !== (prev?.address ?? '');
      return { ...p, site_id: id, location: keepLocation ? p.location : nextSite?.address ?? '' };
    });
  };

  const changeSpeaker = (id: string) => {
    setF((p) => {
      const sp = speakers.find((s) => s.id === id);
      const prevSp = speakers.find((s) => s.id === p.speaker_id);
      // fill the topic from the speaker's card when it is empty or still the previous speaker's topic
      const topic = !p.lecture_topic.trim() || p.lecture_topic === (prevSp?.topic ?? '') ? sp?.topic ?? '' : p.lecture_topic;
      return { ...p, speaker_id: id, lecture_topic: topic };
    });
  };

  const save = useMutation({
    mutationFn: async (v: { starts: string; ends: string; closes: string | null }) => {
      const row = {
        type: f.type,
        title: f.title.trim(),
        starts_at: v.starts,
        ends_at: v.ends,
        site_id: f.site_id,
        location: f.location.trim() || null,
        capacity: f.capacity.trim() === '' ? null : Number(f.capacity),
        waitlist_enabled: f.waitlist_enabled,
        registration_closes_at: v.closes,
        activity_name: f.activity_name.trim() || null,
        instructor_id: f.instructor_id || null,
        speaker_id: f.speaker_id || null,
        lecture_topic: f.lecture_topic.trim() || null,
        description: f.description.trim() || null,
        internal_notes: f.internal_notes.trim() || null,
        ...(lockedStatus ? {} : { status: f.status }),
      };
      if (event) {
        const { data, error } = await supabase.from('events').update(row).eq('id', event.id).select('id').single();
        if (error) throw error;
        return data.id as string;
      }
      const { data, error } = await supabase.from('events').insert(row).select('id').single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (id) => {
      await invalidate(id);
      toast.success(event ? 'השינויים נשמרו' : f.status === 'draft' ? 'המפגש נוצר כטיוטה. כשהכול מוכן, פותחים הרשמה.' : 'המפגש נוצר');
      navigate(`/app/events/${id}`);
    },
    onError: (err) => setErrors({ form: errorMessage(err) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(f);
    setErrors(v.errors);
    if (Object.keys(v.errors).length || !v.starts || !v.ends) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus?.());
      return;
    }
    save.mutate({ starts: v.starts, ends: v.ends, closes: v.closes ?? null });
  };

  const notFriday = f.type === 'friday' && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && new Date(`${f.date}T12:00:00Z`).getUTCDay() !== 5;
  const isPast = !event && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && /^\d{2}:\d{2}$/.test(f.end) && new Date(fromIl(f.date, f.end)).getTime() < Date.now();
  const started = event && hasStarted(event);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {started && (
        <Notice tone="warn" icon="alert">המפגש כבר התחיל. שינוי של התאריך או השעה ישפיע על הדוחות ועל חלון הצ׳ק־אין.</Notice>
      )}

      <Panel title="סוג ומועד">
        <div className="flex flex-col gap-5">
          <ChoiceGroup<EventType>
            legend="סוג הפעילות"
            columns={3}
            value={f.type}
            onChange={changeType}
            options={(['friday', 'bonfire', 'other'] as EventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }))}
          />
          <Input label="כותרת" required value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} maxLength={120} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="תאריך"
              type="date"
              required
              ltr
              value={f.date}
              onChange={(e) => set('date', e.target.value)}
              error={errors.date}
              hint={/^\d{4}-\d{2}-\d{2}$/.test(f.date) ? <span className={cx((notFriday || isPast) && 'font-semibold text-warn')}>{fmtDayLong(fromIl(f.date, '12:00'))}{notFriday ? ' (לא יום שישי)' : ''}{isPast ? ' · המועד כבר עבר (מתאים רק לתיעוד מפגש שהתקיים)' : ''}</span> : undefined}
            />
            <Input label="שעת התחלה" type="time" required ltr value={f.start} onChange={(e) => set('start', e.target.value)} error={errors.start} step={300} />
            <Input label="שעת סיום" type="time" required ltr value={f.end} onChange={(e) => set('end', e.target.value)} error={errors.end} step={300} />
          </div>
          <p className="-mt-2 text-sm text-muted">השעות לפי שעון ישראל.</p>
        </div>
      </Panel>

      <Panel title="מקום">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="מתחם" required value={f.site_id} onChange={(e) => changeSite(e.target.value)} error={errors.site_id}>
            {!f.site_id && <option value="">בחירה</option>}
            {sites.filter((s) => s.is_active || s.id === f.site_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="כתובת או מקום מדויק" value={f.location} onChange={(e) => set('location', e.target.value)} error={errors.location} maxLength={200} hint="מוצג למשתתפים בעמוד ההרשמה" />
        </div>
      </Panel>

      <Panel title="תוכן המפגש">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Input label="פעילות" list="activity-suggestions" value={f.activity_name} onChange={(e) => set('activity_name', e.target.value)} error={errors.activity_name} maxLength={60} placeholder="יוגה / פילאטיס" />
              <datalist id="activity-suggestions">{ACTIVITY_SUGGESTIONS.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
            <Select label="מדריך/ה" value={f.instructor_id} onChange={(e) => set('instructor_id', e.target.value)} hint={instructors.length ? undefined : 'אין עדיין מדריכים מאושרים. מוסיפים במסך מרצים ומדריכים.'}>
              <option value="">לא נקבע</option>
              {instructors.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.status !== 'approved' ? ' (לא מאושר/ת)' : ''}</option>)}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="מרצה אורח/ת"
              value={f.speaker_id}
              onChange={(e) => changeSpeaker(e.target.value)}
              hint={lecturers.length ? undefined : 'אין עדיין מרצים. מוסיפים במסך מרצים ומדריכים.'}
            >
              <option value="">לא נקבע</option>
              {lecturers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}{s.topic ? ` · ${s.topic}` : ''}{s.status === 'proposed' ? ' (ממתין לאישור)' : s.status !== 'approved' ? ' (לא מאושר/ת)' : ''}
                </option>
              ))}
            </Select>
            <Input label="נושא ההרצאה" value={f.lecture_topic} onChange={(e) => set('lecture_topic', e.target.value)} error={errors.lecture_topic} maxLength={160} />
          </div>
          {speaker && speaker.status !== 'approved' && (
            <Notice tone="warn" icon="alert">
              {speaker.full_name} עדיין {speaker.status === 'proposed' ? 'ממתין/ה לאישור' : 'לא מאושר/ת'} של מנהל/ת. אפשר לשבץ, וכדאי לאשר לפני שמפרסמים.
            </Notice>
          )}
          {speaker?.bio_line && <p className="text-sm text-muted">{speaker.bio_line}</p>}
          <Textarea
            label="תיאור למשתתפים"
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
            error={errors.description}
            maxLength={2000}
            rows={3}
            hint="מוצג בעמוד ההרשמה. אפשר להשאיר ריק."
          />
        </div>
      </Panel>

      <Panel title="הרשמה">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="מספר מקומות"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              ltr
              value={f.capacity}
              onChange={(e) => set('capacity', e.target.value)}
              error={errors.capacity}
              hint="ריק = בלי הגבלה"
            />
            <div className="flex flex-col justify-end pb-1 sm:pt-7">
              <Checkbox
                label="רשימת המתנה כשמלא"
                hint="בלי רשימת המתנה, הטופס נסגר כשאין מקום"
                checked={f.waitlist_enabled}
                onChange={(v) => set('waitlist_enabled', v)}
              />
            </div>
          </div>
          <Checkbox
            label="סגירת הרשמה לפני תחילת המפגש"
            hint="בלי סימון, ההרשמה נסגרת כשהמפגש מתחיל"
            checked={f.closes_early}
            onChange={(v) => set('closes_early', v)}
          />
          {f.closes_early && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="תאריך סגירה" type="date" ltr value={f.closes_date} onChange={(e) => set('closes_date', e.target.value)} error={errors.closes_date} />
              <Input label="שעת סגירה" type="time" ltr value={f.closes_time} onChange={(e) => set('closes_time', e.target.value)} step={300} />
            </div>
          )}
          {lockedStatus ? (
            <div className="flex items-center gap-2 text-[0.95rem]">
              <span className="font-semibold">סטטוס:</span>
              <StatusBadge status={f.status} />
              <span className="text-sm text-muted">{f.status === 'cancelled' ? 'המפגש בוטל.' : 'המפגש נסגר.'}</span>
            </div>
          ) : (
            <Select label="סטטוס" value={f.status} onChange={(e) => set('status', e.target.value as EventStatus)} hint="ביטול מפגש וסגירת מפגש שהתקיים נעשים מעמוד המפגש.">
              {(['draft', 'open', 'closed'] as EventStatus[]).map((s) => (
                <option key={s} value={s}>{s === 'draft' ? 'טיוטה (לא מוצג למשתתפים)' : s === 'open' ? 'הרשמה פתוחה' : EVENT_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          )}
        </div>
      </Panel>

      <Panel title="הערות לצוות">
        <Textarea
          label="הערות פנימיות"
          value={f.internal_notes}
          onChange={(e) => set('internal_notes', e.target.value)}
          error={errors.internal_notes}
          maxLength={2000}
          rows={3}
          hint="לא מוצג למשתתפים. בלי מידע אישי או רפואי על משתתפים."
        />
      </Panel>

      {errors.form && <ErrorBox error={errors.form} />}
      {Object.keys(errors).some((k) => k !== 'form' && errors[k as keyof Errors]) && (
        <p className="text-sm font-medium text-bad" role="alert">יש שדות שצריך לתקן. הם מסומנים באדום.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" busy={save.isPending} icon="check">{event ? 'שמירת השינויים' : 'יצירת המפגש'}</Button>
        <ButtonLink to={event ? `/app/events/${event.id}` : '/app/events'} variant="ghost" size="lg">ביטול</ButtonLink>
      </div>
    </form>
  );
}
