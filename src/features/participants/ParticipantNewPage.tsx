import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useSources } from '@/lib/data';
import { fmtDayLong, fmtTime, todayIl } from '@/lib/dates';
import { errorCode, errorMessage, must } from '@/lib/errors';
import { normalizePhone } from '@/lib/phone';
import { Button, ButtonLink, Checkbox, Input, Notice, PageHeader, Panel, Select, Spinner, Textarea } from '@/ui/kit';
import { useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import {
  FieldGuidance, ParticipantPicker, birthDateError, cityError, nameError, phoneError, useDebounced, type PickedParticipant,
} from './shared';

type DupCheck = {
  phone_valid: boolean;
  by_phone: { id: string; full_name: string | null; city: string | null } | null;
  similar: { id: string; full_name: string | null; city: string | null; phone_last4: string | null }[];
};
type UpcomingEvent = { id: string; title: string; starts_at: string; capacity: number | null };

const EMPTY = {
  full_name: '', phone: '', city: '', age: '', birth_date: '', occupation: '', source: '', source_detail: '',
  referrer_name: '', consent: false, photo_opt_out: false, notes: '', event: '',
};

export function ParticipantNewPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const sources = useSources();
  const [f, setF] = useState(EMPTY);
  const [referrer, setReferrer] = useState<PickedParticipant | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((x) => ({ ...x, [k]: v }));
  const source = sources.data?.find((s) => s.id === f.source);

  // live duplicate check (debounced): same phone blocks, similar names warn
  const checkName = useDebounced(f.full_name.trim(), 400);
  const checkPhone = useDebounced(f.phone.trim(), 400);
  const phoneDigits = checkPhone.replace(/\D/g, '').length;
  const dup = useQuery({
    queryKey: ['participants', 'dupcheck', checkName, checkPhone],
    enabled: checkName.length >= 2 || phoneDigits >= 9,
    staleTime: 10_000,
    queryFn: async () => must(await supabase.rpc('staff_check_duplicate', { p_full_name: checkName, p_phone: checkPhone })) as DupCheck,
  });
  const byPhone = dup.data?.by_phone && normalizePhone(f.phone) ? dup.data.by_phone : null;
  const similar = (dup.data?.similar ?? []).filter((s) => s.id !== byPhone?.id);

  const events = useQuery({
    queryKey: ['events', 'upcoming_open'],
    queryFn: async () =>
      must(await supabase.from('events').select('id,title,starts_at,capacity').eq('status', 'open').gt('starts_at', new Date().toISOString())
        .order('starts_at').limit(8)) as UpcomingEvent[],
  });

  const create = useMutation({
    mutationFn: async () => {
      const a = f.age.trim() ? Number(f.age) : null;
      const { data, error } = await supabase.from('participants').insert({
        full_name: f.full_name.trim(),
        phone: normalizePhone(f.phone),
        city: f.city.trim() || null,
        birth_year: !f.birth_date && a ? Number(todayIl().slice(0, 4)) - a : null,
        birth_date: f.birth_date || null,
        occupation: f.occupation.trim() || null,
        first_source_id: f.source || null,
        first_source_detail: source?.asks_detail ? f.source_detail.trim() || null : null,
        referred_by_participant_id: source?.is_friend && referrer ? referrer.id : null,
        referred_by_name: source?.is_friend && !referrer ? f.referrer_name.trim() || null : null,
        consent_updates: f.consent,
        photo_opt_out: f.photo_opt_out,
        notes: f.notes.trim() || null,
      }).select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      let reg: { status: string } | null = null;
      let regError: unknown = null;
      if (f.event) {
        const r = await supabase.rpc('staff_register', { p_event_id: f.event, p_participant_id: id });
        if (r.error) regError = r.error;
        else reg = r.data as { status: string };
      }
      return { id, reg, regError };
    },
    onSuccess: ({ id, reg, regError }) => {
      qc.invalidateQueries({ queryKey: ['participants'] });
      if (f.event) {
        qc.invalidateQueries({ queryKey: ['events'] });
        qc.invalidateQueries({ queryKey: ['event', f.event] });
      }
      if (regError) toast.error(`הכרטיס נוצר, אבל הרישום למפגש לא הצליח: ${errorMessage(regError)}`);
      else if (reg?.status === 'waitlisted') toast.success('הכרטיס נוצר. המפגש מלא, אז נרשם/ה לרשימת ההמתנה.');
      else if (reg) toast.success('הכרטיס נוצר והלוחם/ת רשום/ה למפגש');
      else toast.success('הכרטיס נוצר');
      navigate(`/app/participants/${id}`, { replace: true });
    },
    onError: (e) => {
      if (errorCode(e) === 'duplicate_phone') {
        setErrors((x) => ({ ...x, phone: errorMessage(e) }));
        dup.refetch();
      } else setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    const a = f.age.trim();
    const next: Record<string, string | null> = {
      full_name: nameError(f.full_name),
      phone: phoneError(f.phone),
      city: cityError(f.city),
      age: a && !(/^\d{1,2}$/.test(a) && Number(a) >= 16 && Number(a) <= 99) ? 'גיל בין 16 ל-99.' : null,
      birth_date: birthDateError(f.birth_date),
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean) || byPhone) return;
    create.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="לוחם/ת חדש/ה" back={{ to: '/app/participants', label: 'לכל הלוחמים' }} subtitle="למי שפנה בטלפון או בוואטסאפ. מי שנרשם בטופס נוסף לבד." />
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="flex flex-col gap-5">
        <Panel title="פרטים בסיסיים">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="שם מלא" required value={f.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} maxLength={80} autoComplete="off" autoFocus />
            <Input label="טלפון" required ltr type="tel" inputMode="tel" placeholder="050-1234567" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} autoComplete="off" />
          </div>

          <div aria-live="polite" className="mt-3 flex flex-col gap-3 empty:hidden">
            {dup.isFetching && !dup.data && <p className="flex items-center gap-2 text-sm text-muted"><Spinner size={14} />בודקים אם הלוחם/ת כבר במערכת…</p>}
            {byPhone && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-bad/30 bg-bad-wash px-4 py-3 text-bad sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 font-medium">
                  <Icon name="alert" size={18} className="mt-0.5" />
                  <span>כבר יש כרטיס עם הטלפון הזה: <strong>{byPhone.full_name ?? 'פרטים נמחקו'}</strong>{byPhone.city ? `, ${byPhone.city}` : ''}. לא יוצרים כרטיס נוסף.</span>
                </p>
                {byPhone.full_name && <ButtonLink to={`/app/participants/${byPhone.id}`} variant="secondary" size="sm" className="shrink-0">לכרטיס הקיים</ButtonLink>}
              </div>
            )}
            {!byPhone && similar.length > 0 && (
              <Notice tone="light" icon="people">
                <p className="font-semibold">יש לוחמים עם שם דומה. אולי זה אחד מהם?</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {similar.map((s) => (
                    <li key={s.id}>
                      <a href={`#/app/participants/${s.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-tide hover:underline">{s.full_name}</a>
                      <span className="text-ink-soft">{s.city ? ` · ${s.city}` : ''}{s.phone_last4 ? ' · טלפון שמסתיים ב-' : ''}</span>
                      {s.phone_last4 && <span className="num">{s.phone_last4}</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-ink-soft">אם זה אדם אחר, ממשיכים כרגיל.</p>
              </Notice>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="עיר" value={f.city} onChange={(e) => set('city', e.target.value)} error={errors.city} maxLength={60} />
            <Input label="עיסוק" value={f.occupation} onChange={(e) => set('occupation', e.target.value)} maxLength={80} hint="לא חובה" />
            <Input label="גיל" inputMode="numeric" value={f.age} onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 2))} error={errors.age} hint="או תאריך לידה, אם ידוע" disabled={!!f.birth_date} />
            <Input label="תאריך לידה" type="date" min="1920-01-01" max="2015-12-31" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} error={errors.birth_date} hint="לא חובה" />
          </div>
        </Panel>

        <Panel title="איך הגיע/ה אלינו">
          <div className="flex flex-col gap-4">
            <Select label="מקור היכרות" value={f.source} onChange={(e) => set('source', e.target.value)} hint="נשמר כמקור הראשון של הלוחם/ת ולא משתנה בהרשמות הבאות.">
              <option value="">לא ידוע</option>
              {(sources.data ?? []).filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            {source?.asks_detail && <Input label="פירוט" value={f.source_detail} onChange={(e) => set('source_detail', e.target.value)} maxLength={120} />}
            {source?.is_friend && (
              <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-mist p-3.5">
                <p className="text-sm font-semibold">מי הביא/ה?</p>
                {referrer ? (
                  <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-paper px-3.5 py-2.5">
                    <span className="font-semibold">{referrer.full_name}</span>
                    <Button size="sm" variant="ghost" onClick={() => setReferrer(null)}>החלפה</Button>
                  </div>
                ) : (
                  <>
                    <ParticipantPicker onPick={(p) => { setReferrer(p); set('referrer_name', ''); }} label="חיפוש החבר/ה במערכת" />
                    <Input label="לא במערכת? כותבים את השם" value={f.referrer_name} onChange={(e) => set('referrer_name', e.target.value)} maxLength={80} />
                  </>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="הסכמות והערות">
          <div className="flex flex-col gap-4">
            <Checkbox
              label="הלוחם/ת הסכים/ה לקבל עדכונים והזמנות בוואטסאפ"
              hint="מסמנים רק אם הלוחם/ת אמר/ה במפורש שזה בסדר. בלי הסכמה אפשר להתקשר ולשלוח הודעות שירות על מפגש שנרשם/ה אליו."
              checked={f.consent}
              onChange={(v) => set('consent', v)}
            />
            <Checkbox label="לא מעוניין/ת להופיע בתמונות" checked={f.photo_opt_out} onChange={(v) => set('photo_opt_out', v)} />
            <div className="flex flex-col gap-2">
              <Textarea label="הערות לצוות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} rows={3} />
              <FieldGuidance />
            </div>
          </div>
        </Panel>

        <Panel title="לרשום גם למפגש?">
          {events.data && events.data.length === 0 ? (
            <p className="text-[0.95rem] text-muted">אין כרגע מפגש פתוח להרשמה.</p>
          ) : (
            <Select label="מפגש" value={f.event} onChange={(e) => set('event', e.target.value)} hint="אם המפגש מלא, הלוחם/ת ייכנס/תיכנס לרשימת ההמתנה.">
              <option value="">לא עכשיו</option>
              {(events.data ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title} · {fmtDayLong(ev.starts_at)} · {fmtTime(ev.starts_at)}</option>)}
            </Select>
          )}
        </Panel>

        {formError && <p className="text-sm font-medium text-bad" role="alert">{formError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" icon="userPlus" busy={create.isPending} disabled={!!byPhone}>יצירת הכרטיס</Button>
          <ButtonLink to="/app/participants" variant="ghost" size="lg">ביטול</ButtonLink>
        </div>
      </form>
    </div>
  );
}
