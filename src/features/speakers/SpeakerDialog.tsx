import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { personPhotoUrl, supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatPhone, normalizePhone } from '@/lib/phone';
import type { Speaker } from '@/lib/types';
import { Button, Checkbox, ChoiceGroup, Input, Notice, Textarea, cx } from '@/ui/kit';
import { Icon } from '@/ui/Icon';
import { Dialog, useToast } from '@/ui/feedback';
import { nameError } from '@/features/participants/shared';
import { PhotoError, removePhoto, uploadPhoto } from './photo';

/** The card line reads best short; the database allows 240. */
const LINE_SOFT_MAX = 120;

export function SpeakerDialog({ speaker, defaultKind, onClose }: { speaker: Speaker | null; defaultKind: Speaker['kind']; onClose: () => void }) {
  const role = useRole();
  const admin = can.admin(role);
  const toast = useToast();
  const qc = useQueryClient();
  // a new card gets its id here, so its photo can be named after it before the card is saved
  const [id] = useState(() => speaker?.id ?? crypto.randomUUID());
  const [f, setF] = useState({
    kind: speaker?.kind ?? defaultKind,
    full_name: speaker?.full_name ?? '',
    topic: speaker?.topic ?? '',
    bio_line: speaker?.bio_line ?? '',
    role_label: speaker?.role_label ?? '',
    about: speaker?.about ?? '',
    photo_path: speaker?.photo_path ?? null as string | null,
    phone: formatPhone(speaker?.phone),
    social_url: speaker?.social_url ?? '',
    notes: speaker?.notes ?? '',
    approve: true,
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // photos uploaded while the dialog is open: whatever is not kept is deleted on save or on cancel
  const uploaded = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const path = await uploadPhoto(file);
      uploaded.current.push(path);
      set('photo_path', path);
    } catch (e) {
      setPhotoError(e instanceof PhotoError ? e.message : errorMessage(e));
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  /** Delete objects that are no longer used (best effort; the card is already right). */
  const sweep = (keep: string | null) => {
    const drop = [...uploaded.current, speaker?.photo_path].filter((p): p is string => !!p && p !== keep);
    uploaded.current = [];
    return Promise.allSettled(drop.map(removePhoto)).then((r) => r.every((x) => x.status === 'fulfilled'));
  };

  const cancel = () => {
    // nothing saved: only this dialog's own uploads go (the saved photo stays)
    const mine = uploaded.current;
    uploaded.current = [];
    void Promise.allSettled(mine.map(removePhoto));
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        kind: f.kind,
        full_name: f.full_name.trim(),
        topic: f.topic.trim() || null,
        bio_line: f.bio_line.trim() || null,
        role_label: f.role_label.trim() || null,
        about: f.about.trim() || null,
        photo_path: f.photo_path,
        phone: f.phone.trim() ? normalizePhone(f.phone) : null,
        social_url: f.social_url.trim() || null,
        notes: f.notes.trim() || null,
      };
      const res = speaker
        ? await supabase.from('speakers').update(row).eq('id', speaker.id)
        : await supabase.from('speakers').insert({ ...row, id, status: admin && f.approve ? 'approved' : 'proposed', source: 'staff' });
      if (res.error) throw res.error;
      return sweep(f.photo_path);
    },
    onSuccess: (swept) => {
      qc.invalidateQueries({ queryKey: ['speakers'] });
      qc.invalidateQueries({ queryKey: ['report_presenters'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      if (!swept) toast.error('הפרטים נשמרו, אבל תמונה ישנה לא נמחקה מהאחסון. כדאי לנסות שוב מאוחר יותר.');
      else toast.success(speaker ? 'הפרטים נשמרו' : admin && f.approve ? 'ההוספה והאישור נשמרו' : 'ההצעה נשמרה ומחכה לאישור מנהלים');
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const url = f.social_url.trim();
    const next = {
      full_name: nameError(f.full_name),
      topic: f.topic.trim().length < 2 ? (f.kind === 'speaker' ? 'צריך לכתוב נושא להרצאה.' : 'צריך לכתוב איזו פעילות.') : null,
      phone: f.phone.trim() && !normalizePhone(f.phone) ? 'מספר הטלפון לא נראה תקין. למשל: 050-1234567.' : null,
      social_url: url && !/^https:\/\/[^\s<>"]+$/i.test(url) ? 'הקישור צריך להתחיל ב-https://' : url.length > 300 ? 'הקישור ארוך מדי.' : null,
      role_label: f.role_label.trim().length > 30 ? 'עד 30 תווים.' : null,
      bio_line: f.bio_line.trim().length > 240 ? 'עד 240 תווים.' : null,
      about: f.about.trim().length > 600 ? 'עד 600 תווים.' : null,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    save.mutate();
  };

  return (
    <Dialog
      open
      onClose={cancel}
      title={speaker ? `עריכה: ${speaker.full_name}` : f.kind === 'instructor' ? 'מדריך חדש' : 'מרצה חדש'}
      footer={<>
        <Button busy={save.isPending} disabled={photoBusy} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={cancel}>ביטול</Button>
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <ChoiceGroup<Speaker['kind']>
          legend="תפקיד"
          value={f.kind}
          onChange={(v) => set('kind', v)}
          options={[{ value: 'speaker', label: 'מרצה' }, { value: 'instructor', label: 'הדרכה (יוגה, פילאטיס)' }]}
        />
        <PhotoField
          name={f.full_name.trim() || 'האדם'}
          path={f.photo_path}
          busy={photoBusy}
          error={photoError}
          removed={!f.photo_path && !!speaker?.photo_path}
          onPick={() => fileInput.current?.click()}
          onRemove={() => { setPhotoError(null); set('photo_path', null); }}
        />
        <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
        <Input label="שם מלא" required value={f.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} maxLength={80} />
        <Input label={f.kind === 'speaker' ? 'נושא ההרצאה' : 'פעילות'} required value={f.topic} onChange={(e) => set('topic', e.target.value)} error={errors.topic} maxLength={160} />
        <Textarea
          label="שורה קצרה לכרטיס"
          value={f.bio_line}
          onChange={(e) => set('bio_line', e.target.value)}
          error={errors.bio_line}
          maxLength={240}
          rows={2}
          hint={<>מופיעה ליד השם בעמוד ההרשמה ובדף המפגש (רק אחרי אישור). <span className={cx('whitespace-nowrap', f.bio_line.length > LINE_SOFT_MAX && 'font-semibold text-warn')}><span className="num">{f.bio_line.length}</span> תווים, מומלץ עד <span className="num">{LINE_SOFT_MAX}</span>.</span></>}
        />

        <fieldset className="flex flex-col gap-4 border-t border-edge pt-4">
          <legend className="sr-only">דף המפגש</legend>
          <p aria-hidden="true" className="-mb-1 text-small font-semibold text-ink">לדף ״כל הפרטים על המפגש״</p>
          <Input
            label="תיאור תפקיד בדף המפגש"
            value={f.role_label}
            onChange={(e) => set('role_label', e.target.value)}
            error={errors.role_label}
            maxLength={30}
            placeholder={f.kind === 'speaker' ? 'מרצה אורחת' : 'מאמן קרוספיט'}
            hint={<>אם נשאר ריק: {f.kind === 'speaker' ? '״הרצאת אורח״' : '״אימון״ ושם הפעילות'}. <span className="whitespace-nowrap"><span className="num">{f.role_label.length}</span> מתוך <span className="num">30</span> תווים.</span></>}
          />
          <Textarea
            label="כמה מילים לדף המפגש"
            value={f.about}
            onChange={(e) => set('about', e.target.value)}
            error={errors.about}
            maxLength={600}
            rows={5}
            hint={<>נפתח בלחיצה על ״קראו עוד״. אפשר לחלק לפסקאות. <span className="whitespace-nowrap"><span className="num">{f.about.length}</span> מתוך <span className="num">600</span> תווים.</span></>}
          />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="טלפון" ltr type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
          <Input label="קישור (אינסטגרם, לינקדאין, אתר)" ltr type="url" placeholder="https://" value={f.social_url} onChange={(e) => set('social_url', e.target.value)} error={errors.social_url} maxLength={300} />
        </div>
        <Textarea label="הערות לצוות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} rows={3} />
        {!speaker && (admin ? (
          <Checkbox label="לאשר מיד" hint="אחרי אישור אפשר לשבץ במפגש ולהציג בעמוד ההרשמה." checked={f.approve} onChange={(v) => set('approve', v)} />
        ) : (
          <Notice icon="shield">ההצעה תחכה ב"מחכים לאישור" עד לאישור מנהלים.</Notice>
        ))}
        {formError && <p className="text-small font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** The photo on the public meeting page: a 4:5 preview, upload or replace, and remove. Saved with the card. */
function PhotoField({ name, path, busy, error, removed, onPick, onRemove }: {
  name: string; path: string | null; busy: boolean; error: string | null; removed: boolean; onPick: () => void; onRemove: () => void;
}) {
  return (
    <div role="group" aria-labelledby="photo-label" aria-describedby="photo-hint" className="flex flex-col gap-1.5">
      <p id="photo-label" className="text-small font-medium text-ink">תמונה לדף המפגש</p>
      <div className="flex items-start gap-4">
        <div className="flex h-[100px] w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-edge bg-mist text-muted">
          {path ? (
            <img src={personPhotoUrl(path)} alt={`התמונה של ${name}`} width={80} height={100} className="h-full w-full object-cover" />
          ) : (
            <Icon name="image" size={24} />
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2">
          <Button variant="secondary" icon="image" busy={busy} onClick={onPick}>{path ? 'החלפת התמונה' : 'העלאת תמונה'}</Button>
          {path && <Button variant="ghost" className="-ms-3" onClick={onRemove} disabled={busy}>הסרת התמונה</Button>}
          <p className="text-small text-muted empty:hidden" role="status">{removed ? 'התמונה תימחק בשמירה.' : ''}</p>
        </div>
      </div>
      <p id="photo-hint" className="text-small font-medium text-ink-soft">מעלים רק תמונה שהאדם הסכים שתפורסם באתר.</p>
      <p className="text-small text-muted">התמונה נחתכת לדיוקן (4:5) ומוקטנת לפני ההעלאה.</p>
      {error && <p className="flex items-center gap-1 text-small font-medium text-bad" role="alert"><Icon name="alert" size={15} />{error}</p>}
    </div>
  );
}
