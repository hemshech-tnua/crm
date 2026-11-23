// Dialogs on the participant card: edit, log a conversation, link the referrer, choose a WhatsApp message.
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useSources, useTemplates } from '@/lib/data';
import { errorCode, errorMessage } from '@/lib/errors';
import { CHANNEL_LABEL, DISMISS, MEMBERSHIP_LABEL } from '@/lib/labels';
import type { Membership } from '@/lib/types';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { fmtDayLong } from '@/lib/dates';
import { Button, Checkbox, ChoiceGroup, Input, Notice, Select, Textarea, cx } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { MessageComposer, type Recipient } from '@/ui/MessageComposer';
import type { Channel } from '@/features/followups/shared';
import type { Card, CardRegistration } from './cardData';
import {
  FieldGuidance, ParticipantPicker, birthDateError, cityError, eventContext, nameError, phoneError,
  type EventForMessage, type PickedParticipant,
} from './shared';

function useInvalidateCard() {
  const qc = useQueryClient();
  return (...ids: (string | null | undefined)[]) => {
    qc.invalidateQueries({ queryKey: ['participants'] });
    for (const id of ids) if (id) qc.invalidateQueries({ queryKey: ['participant', id] });
  };
}

// ───────────── edit ─────────────

export function EditParticipantDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const toast = useToast();
  const sources = useSources();
  const invalidate = useInvalidateCard();
  const [initial] = useState(() => ({
    full_name: card.full_name ?? '',
    phone: formatPhone(card.phone),
    city: card.city ?? '',
    birth_date: card.birth_date ?? '',
    occupation: card.occupation ?? '',
    first_source_id: card.first_source_id ?? '',
    first_source_detail: card.first_source_detail ?? '',
    notes: card.notes ?? '',
    consent_updates: card.consent_updates,
    photo_opt_out: card.photo_opt_out,
    membership: card.membership,
    member_since: card.member_since ?? ''
  }));
  const [f, setF] = useState(initial);
  // a form dialog with typed changes ignores a tap outside, and asks before Escape or × close it
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [dupe, setDupe] = useState<{ id: string; full_name: string | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const source = sources.data?.find((s) => s.id === f.first_source_id);

  const save = useMutation({
    mutationFn: async () => {
      const phone = normalizePhone(f.phone)!;
      if (phone !== card.phone) {
        // ask first, so a taken number gets a link to the other card instead of a failed save
        const { data } = await supabase.rpc('staff_check_duplicate', { p_full_name: '', p_phone: phone });
        const other = (data as { by_phone: { id: string; full_name: string | null } | null } | null)?.by_phone;
        if (other && other.id !== card.id) {
          setDupe(other);
          throw { message: 'duplicate_phone' };
        }
      }
      const { error } = await supabase.from('participants').update({
        full_name: f.full_name.trim(),
        phone,
        city: f.city.trim() || null,
        birth_date: f.birth_date || null,
        occupation: f.occupation.trim() || null,
        first_source_id: f.first_source_id || null,
        first_source_detail: source?.asks_detail ? f.first_source_detail.trim() || null : null,
        notes: f.notes.trim() || null,
        consent_updates: f.consent_updates,
        photo_opt_out: f.photo_opt_out,
        membership: f.membership,
        // empty date with "member": the server fills in today
        member_since: f.membership === 'member' ? f.member_since || null : null,
      }).eq('id', card.id);
      if (error) {
        if (errorCode(error) === 'duplicate_phone') {
          const { data } = await supabase.from('participants').select('id,full_name').eq('phone', phone).neq('id', card.id).maybeSingle();
          setDupe(data ?? null);
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidate(card.id);
      toast.success('הפרטים נשמרו');
      onClose();
    },
    onError: (e) => {
      if (errorCode(e) === 'duplicate_phone') setErrors((x) => ({ ...x, phone: errorMessage(e) }));
      else setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    const next = {
      full_name: nameError(f.full_name),
      phone: phoneError(f.phone),
      city: cityError(f.city),
      birth_date: birthDateError(f.birth_date),
    };
    setErrors(next);
    setDupe(null);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!dirty}
      size="lg"
      title="עריכת פרטים"
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>
      </>}
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="שם מלא" required value={f.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} maxLength={80} autoComplete="off" />
        <div className="flex flex-col gap-1.5">
          <Input label="טלפון" required ltr inputMode="tel" value={f.phone} onChange={(e) => { set('phone', e.target.value); setDupe(null); }} error={errors.phone} autoComplete="off" />
          {dupe && (
            <p className="text-small">
              <Link to={`/app/participants/${dupe.id}`} onClick={onClose} className="font-semibold text-tide hover:underline">לכרטיס של {dupe.full_name}</Link>
              <span className="text-muted"> · אם זה אותו אדם, אפשר למזג בדף "כפילויות אפשריות".</span>
            </p>
          )}
        </div>
        <Input label="עיר" value={f.city} onChange={(e) => set('city', e.target.value)} error={errors.city} maxLength={60} />
        <Input label="עיסוק" value={f.occupation} onChange={(e) => set('occupation', e.target.value)} maxLength={80} hint="לא חובה" />
        <Input
          label="תאריך לידה"
          type="date"
          min="1920-01-01"
          max="2015-12-31"
          value={f.birth_date}
          onChange={(e) => set('birth_date', e.target.value)}
          error={errors.birth_date}
          hint={card.birth_year && !card.birth_date ? `כרגע ידועה רק שנת לידה משוערת (${card.birth_year}) מהגיל שנמסר בהרשמה.` : 'לא חובה. משמש לברכת יום הולדת.'}
        />
        <Select label="מקור הגעה" value={f.first_source_id} onChange={(e) => set('first_source_id', e.target.value)}>
          <option value="">לא ידוע</option>
          {(sources.data ?? []).filter((s) => s.is_active || s.id === f.first_source_id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        <Select label="חברות בעמותה" value={f.membership} onChange={(e) => set('membership', e.target.value as Membership)}>
          {(['none', 'requested', 'member'] as const).map((m) => <option key={m} value={m}>{MEMBERSHIP_LABEL[m]}</option>)}
        </Select>
        {f.membership === 'member' ? (
          <Input label="חברות מתאריך" type="date" min="1990-01-01" max="2100-12-31" value={f.member_since} onChange={(e) => set('member_since', e.target.value)} hint="ריק = היום" />
        ) : <div className="hidden sm:block" aria-hidden="true" />}
        {source?.asks_detail && (
          <Input label="פירוט מקור ההגעה" value={f.first_source_detail} onChange={(e) => set('first_source_detail', e.target.value)} maxLength={120} className="sm:col-span-2" />
        )}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Textarea label="הערות לצוות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} rows={3} />
          <FieldGuidance />
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Checkbox
            label="יש הסכמה לקבל עדכונים והזמנות בוואטסאפ"
            hint="מסמנים רק אחרי אישור מפורש. הסימון נשמר ביומן ההסכמות."
            checked={f.consent_updates}
            onChange={(v) => set('consent_updates', v)}
          />
          <Checkbox label="בקשה לא להופיע בתמונות" checked={f.photo_opt_out} onChange={(v) => set('photo_opt_out', v)} />
        </div>
        {formError && <p className="text-small font-medium text-bad sm:col-span-2" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// ───────────── log a call / meeting ─────────────

export function LogContactDialog({ participantId, name, onClose }: { participantId: string; name: string | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<Channel>('phone');
  const [summary, setSummary] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('contact_log').insert({ participant_id: participantId, channel, summary: summary.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact_log', participantId] });
      toast.success('השיחה תועדה');
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    if (summary.trim().length < 2) return setErr('כותבים במשפט קצר מה עלה.');
    setErr(null);
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!summary.trim()}
      title={`תיעוד שיחה עם ${name ?? ''}`}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup<Channel>
          legend="איך דיברתם?"
          value={channel}
          onChange={setChannel}
          options={(['phone', 'in_person', 'whatsapp', 'other'] as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
        <div className="flex flex-col gap-2">
          <Textarea label="מה עלה?" required value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} rows={4} error={err} placeholder="למשל: שאל על המפגש הבא, ביקש לצרף חבר" />
          <FieldGuidance />
        </div>
      </div>
    </Dialog>
  );
}

// ───────────── who invited them ─────────────

export function ReferrerDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateCard();
  const save = useMutation({
    mutationFn: async (ref: PickedParticipant | null) => {
      const { error } = await supabase.from('participants')
        .update(ref ? { referred_by_participant_id: ref.id, referred_by_name: null } : { referred_by_participant_id: null })
        .eq('id', card.id);
      if (error) throw error;
      return ref;
    },
    onSuccess: (ref) => {
      invalidate(card.id, ref?.id, card.referred_by_participant_id);
      toast.success(ref ? `נשמר הקישור בין ${card.full_name} ל${ref.full_name}` : 'הקישור הוסר');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title="מי הזמין?">
      <div className="flex flex-col gap-4">
        {card.referred_by_name && (
          <Notice icon="people">
            בהרשמה נכתב: <strong>{card.referred_by_name}</strong>. מחפשים את הכרטיס הזה וקושרים, כדי שההזמנה תיספר בדוחות.
          </Notice>
        )}
        <ParticipantPicker onPick={(p) => save.mutate(p)} excludeId={card.id} label="חיפוש מי שהזמין" />
        {card.referred_by_participant_id && (
          <Button variant="ghost" className="self-start" busy={save.isPending} onClick={() => save.mutate(null)}>הסרת הקישור הנוכחי</Button>
        )}
      </div>
    </Dialog>
  );
}

// ───────────── WhatsApp: pick what the message is about ─────────────

type Purpose = { key: string; title: string; about: string; ev: EventForMessage | null | undefined; marketing?: boolean };

export function MessageChooser({ recipient, regs, nextEvent, onClose }: {
  recipient: Recipient; regs: CardRegistration[]; nextEvent: EventForMessage | null | undefined; onClose: () => void;
}) {
  const templates = useTemplates();
  const [picked, setPicked] = useState<Purpose | null>(null);
  const purposes = useMemo(() => {
    const now = Date.now();
    const byDate = [...regs].filter((r) => r.event).sort((a, b) => b.event!.starts_at.localeCompare(a.event!.starts_at));
    const upcoming = byDate.filter((r) => (r.status === 'registered' || r.status === 'waitlisted') && new Date(r.event!.starts_at).getTime() > now).at(-1);
    const lastNoShow = byDate.find((r) => r.attendance === 'no_show');
    const lastAttended = byDate.find((r) => r.attendance === 'attended');
    const out: Purpose[] = [];
    if (upcoming) out.push({ key: 'reminder', title: 'תזכורת למפגש', about: `${upcoming.event!.title}, ${fmtDayLong(upcoming.event!.starts_at)}`, ev: upcoming.event });
    out.push({ key: 'invite_next', title: 'הזמנה למפגש הבא', about: nextEvent ? `${nextEvent.title}, ${fmtDayLong(nextEvent.starts_at)}` : 'אין כרגע מפגש פתוח: הקישור יוביל לרשימת המפגשים', ev: nextEvent, marketing: true });
    out.push({ key: 'lapsed', title: 'מזמן לא התראינו', about: 'שאלה מה נשמע + קישור להרשמה', ev: nextEvent, marketing: true });
    if (lastNoShow) out.push({ key: 'missed_you', title: 'חסרת לנו', about: `על ${lastNoShow.event!.title}, ${fmtDayLong(lastNoShow.event!.starts_at)}`, ev: lastNoShow.event });
    if (lastAttended) out.push({ key: 'thanks', title: 'תודה + קישור למשוב', about: `על ${lastAttended.event!.title}, ${fmtDayLong(lastAttended.event!.starts_at)}`, ev: lastAttended.event });
    const known = new Set((templates.data ?? []).map((t) => t.key));
    return templates.data ? out.filter((p) => known.has(p.key)) : out;
  }, [regs, nextEvent, templates.data]);

  if (picked) {
    return (
      <MessageComposer
        open
        onClose={onClose}
        recipient={recipient}
        context={eventContext(picked.ev)}
        templateKeys={[picked.key]}
        defaultKey={picked.key}
        eventId={picked.ev?.id ?? null}
      />
    );
  }
  return (
    <Dialog open onClose={onClose} title={`הודעה ל${recipient.full_name ?? ''}`}>
      <p className="mb-3 text-body text-ink-soft">על מה ההודעה?</p>
      <ul className="flex flex-col gap-2">
        {purposes.map((p) => {
          const blocked = p.marketing && !recipient.consent_updates;
          return (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => setPicked(p)}
                className={cx(
                  'flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border px-4 py-2.5 text-right transition-colors',
                  blocked ? 'border-edge bg-mist/60' : 'border-control-line bg-paper hover:border-ink hover:bg-ink/[0.04]',
                )}
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{p.title}</span>
                  <span className="block text-small text-muted">{blocked ? 'אין הסכמה לעדכונים בוואטסאפ: אפשר רק להתקשר' : p.about}</span>
                </span>
                <Icon name="chevron" size={18} className="text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

// ───────────── merge with another card of the same person ─────────────

/**
 * Pick the other card, choose which one stays, confirm. The merge itself is the same server call as on the
 * duplicates page (staff_merge_participants): history moves to the card that stays, the other card and its phone go.
 */
export function MergeDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [other, setOther] = useState<PickedParticipant | null>(null);
  const [keepThis, setKeepThis] = useState(true);
  const self: PickedParticipant = { id: card.id, full_name: card.full_name, phone: card.phone, city: card.city };
  const kept = other ? (keepThis ? self : other) : null;
  const gone = other ? (keepThis ? other : self) : null;

  const merge = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('staff_merge_participants', { p_keep: kept!.id, p_merge: gone!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participants'] });
      qc.invalidateQueries({ queryKey: ['participant', kept!.id] });
      qc.removeQueries({ queryKey: ['participant', gone!.id] });
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      toast.success(`הכרטיסים מוזגו לכרטיס של ${kept!.full_name}`);
      onClose();
      if (kept!.id !== card.id) navigate(`/app/participants/${kept!.id}`, { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="מיזוג עם כרטיס אחר"
      footer={other ? <>
        <Button variant="danger" icon="merge" busy={merge.isPending} onClick={() => merge.mutate()}>מיזוג הכרטיסים</Button>
        <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>
      </> : <Button variant="ghost" onClick={onClose}>{DISMISS}</Button>}
    >
      {!other ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-soft">מיזוג מתאים כשלאותו אדם יש שני כרטיסים (למשל, אם נרשם פעם עם מספר אחר). מחפשים את הכרטיס השני:</p>
          <ParticipantPicker onPick={setOther} excludeId={card.id} label="חיפוש הכרטיס השני" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-small font-medium text-ink">איזה כרטיס נשאר?</legend>
            {[{ p: self, keep: true }, { p: other, keep: false }].map(({ p, keep }) => (
              <label key={p.id} className={cx(
                'flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border-2 px-3.5 py-2.5',
                keepThis === keep ? 'border-ink' : 'border-edge hover:border-control-line',
              )}>
                <input type="radio" name="merge-keep" checked={keepThis === keep} onChange={() => setKeepThis(keep)} className="h-5 w-5 accent-tide" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.full_name}{keep && <span className="font-normal text-muted"> (הכרטיס הזה)</span>}</span>
                  <span className="block text-small text-muted"><span className="num">{formatPhone(p.phone)}</span>{p.city ? ` · ${p.city}` : ''}</span>
                </span>
                <span className={cx('text-small font-semibold', keepThis === keep ? 'text-tide' : 'text-muted')}>{keepThis === keep ? 'נשאר' : 'יתמזג'}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2 text-body text-ink-soft">
            <p>
              ההרשמות וההגעות, המשובים, משימות המעקב ויומן השיחות של <strong className="text-ink">{gone!.full_name}</strong> עוברים לכרטיס של <strong className="text-ink">{kept!.full_name}</strong>.
              פרטים שחסרים בכרטיס שנשאר יושלמו מהכרטיס השני.
            </p>
            <Notice tone="warn" icon="alert">
              <span>
                הטלפון <strong className="num" dir="ltr">{formatPhone(gone!.phone)}</strong> יימחק יחד עם הכרטיס השני. בכרטיס שנשאר יישאר רק הטלפון <span className="num" dir="ltr">{formatPhone(kept!.phone)}</span>.
                אם צריך את המספר השני, כדאי לרשום אותו קודם בהערות. אי אפשר לבטל את המיזוג.
              </span>
            </Notice>
          </div>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setOther(null)}>בחירת כרטיס אחר</Button>
        </div>
      )}
    </Dialog>
  );
}
