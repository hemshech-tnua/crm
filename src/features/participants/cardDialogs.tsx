// Dialogs on the participant card: edit, log a conversation, link the referrer, choose a WhatsApp message.
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { useSources, useTemplates } from '@/lib/data';
import { errorCode, errorMessage } from '@/lib/errors';
import { CHANNEL_LABEL } from '@/lib/labels';
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
  const [f, setF] = useState({
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
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [dupe, setDupe] = useState<{ id: string; full_name: string | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const source = sources.data?.find((s) => s.id === f.first_source_id);

  const save = useMutation({
    mutationFn: async () => {
      const phone = normalizePhone(f.phone)!;
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
      size="lg"
      title="עריכת פרטים"
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </>}
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="שם מלא" required value={f.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} maxLength={80} autoComplete="off" />
        <div className="flex flex-col gap-1.5">
          <Input label="טלפון" required ltr inputMode="tel" value={f.phone} onChange={(e) => { set('phone', e.target.value); setDupe(null); }} error={errors.phone} autoComplete="off" />
          {dupe && (
            <p className="text-sm">
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
        <Select label="איך הגיע/ה אלינו לראשונה" value={f.first_source_id} onChange={(e) => set('first_source_id', e.target.value)}>
          <option value="">לא ידוע</option>
          {(sources.data ?? []).filter((s) => s.is_active || s.id === f.first_source_id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        {source?.asks_detail && (
          <Input label="פירוט המקור" value={f.first_source_detail} onChange={(e) => set('first_source_detail', e.target.value)} maxLength={120} className="sm:col-span-2" />
        )}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Textarea label="הערות לצוות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} rows={3} />
          <FieldGuidance />
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Checkbox
            label="מסכים/ה לקבל עדכונים והזמנות בוואטסאפ"
            hint="מסמנים רק אם הלוחם/ת אישר/ה במפורש. הסימון נשמר ביומן ההסכמות."
            checked={f.consent_updates}
            onChange={(v) => set('consent_updates', v)}
          />
          <Checkbox label="לא מעוניין/ת להופיע בתמונות" checked={f.photo_opt_out} onChange={(v) => set('photo_opt_out', v)} />
        </div>
        {formError && <p className="text-sm font-medium text-bad sm:col-span-2" role="alert">{formError}</p>}
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
      title={`תיעוד שיחה עם ${name ?? ''}`}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
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

// ───────────── who brought them ─────────────

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
      toast.success(ref ? `${card.full_name} מקושר/ת עכשיו ל${ref.full_name}` : 'הקישור הוסר');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title="מי הביא/ה?">
      <div className="flex flex-col gap-4">
        {card.referred_by_name && (
          <Notice icon="people">
            בהרשמה נכתב: <strong>{card.referred_by_name}</strong>. מחפשים את הכרטיס שלו/ה וקושרים, כדי שההפניה תיספר לו/ה בדוחות.
          </Notice>
        )}
        <ParticipantPicker onPick={(p) => save.mutate(p)} excludeId={card.id} label="חיפוש מי שהביא/ה" />
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
    const upcoming = byDate.filter((r) => r.status !== 'cancelled' && new Date(r.event!.starts_at).getTime() > now).at(-1);
    const lastNoShow = byDate.find((r) => r.attendance === 'no_show');
    const lastAttended = byDate.find((r) => r.attendance === 'attended');
    const out: Purpose[] = [];
    if (upcoming) out.push({ key: 'reminder', title: 'תזכורת למפגש', about: `${upcoming.event!.title}, ${fmtDayLong(upcoming.event!.starts_at)}`, ev: upcoming.event });
    out.push({ key: 'invite_next', title: 'הזמנה למפגש הבא', about: nextEvent ? `${nextEvent.title}, ${fmtDayLong(nextEvent.starts_at)}` : 'אין כרגע מפגש פתוח: הקישור יוביל לרשימת המפגשים', ev: nextEvent, marketing: true });
    out.push({ key: 'lapsed', title: 'מזמן לא התראינו', about: 'שאלה מה שלומו/ה + קישור להרשמה', ev: nextEvent, marketing: true });
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
      <p className="mb-3 text-[0.95rem] text-ink-soft">על מה ההודעה?</p>
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
                  blocked ? 'border-line-soft bg-mist/60' : 'border-line bg-paper hover:border-tide hover:bg-tide-wash',
                )}
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{p.title}</span>
                  <span className="block text-sm text-muted">{blocked ? 'לא אישר/ה עדכונים בוואטסאפ: אפשר רק להתקשר' : p.about}</span>
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
