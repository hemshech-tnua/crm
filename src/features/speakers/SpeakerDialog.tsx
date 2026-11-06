import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { can, useRole } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatPhone, normalizePhone } from '@/lib/phone';
import type { Speaker } from '@/lib/types';
import { Button, Checkbox, ChoiceGroup, Input, Notice, Textarea } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';
import { nameError } from '@/features/participants/shared';

export function SpeakerDialog({ speaker, defaultKind, onClose }: { speaker: Speaker | null; defaultKind: Speaker['kind']; onClose: () => void }) {
  const role = useRole();
  const admin = can.admin(role);
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    kind: speaker?.kind ?? defaultKind,
    full_name: speaker?.full_name ?? '',
    topic: speaker?.topic ?? '',
    bio_line: speaker?.bio_line ?? '',
    phone: formatPhone(speaker?.phone),
    social_url: speaker?.social_url ?? '',
    notes: speaker?.notes ?? '',
    approve: true,
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        kind: f.kind,
        full_name: f.full_name.trim(),
        topic: f.topic.trim() || null,
        bio_line: f.bio_line.trim() || null,
        phone: f.phone.trim() ? normalizePhone(f.phone) : null,
        social_url: f.social_url.trim() || null,
        notes: f.notes.trim() || null,
      };
      const res = speaker
        ? await supabase.from('speakers').update(row).eq('id', speaker.id)
        : await supabase.from('speakers').insert({ ...row, status: admin && f.approve ? 'approved' : 'proposed', source: 'staff' });
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['speakers'] });
      qc.invalidateQueries({ queryKey: ['report_presenters'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      toast.success(speaker ? 'הפרטים נשמרו' : admin && f.approve ? 'נוסף/ה ואושר/ה' : 'נוסף/ה. מחכה לאישור של מנהל/ת');
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const url = f.social_url.trim();
    const next = {
      full_name: nameError(f.full_name),
      topic: f.topic.trim().length < 2 ? (f.kind === 'speaker' ? 'צריך לכתוב נושא להרצאה.' : 'צריך לכתוב איזו פעילות.') : null,
      phone: f.phone.trim() && !normalizePhone(f.phone) ? 'מספר הטלפון לא נראה תקין. כותבים כמו 050-1234567.' : null,
      social_url: url && !/^https:\/\/[^\s<>"]+$/i.test(url) ? 'הקישור צריך להתחיל ב-https://' : url.length > 300 ? 'הקישור ארוך מדי.' : null,
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
      title={speaker ? `עריכה: ${speaker.full_name}` : 'מרצה או מדריך/ה חדש/ה'}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>שמירה</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <ChoiceGroup<Speaker['kind']>
          legend="תפקיד"
          value={f.kind}
          onChange={(v) => set('kind', v)}
          options={[{ value: 'speaker', label: 'מרצה' }, { value: 'instructor', label: 'מדריך/ה (יוגה, פילאטיס)' }]}
        />
        <Input label="שם מלא" required value={f.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} maxLength={80} />
        <Input label={f.kind === 'speaker' ? 'נושא ההרצאה' : 'פעילות'} required value={f.topic} onChange={(e) => set('topic', e.target.value)} error={errors.topic} maxLength={160} />
        <Input label="משפט אחד עליו/ה" value={f.bio_line} onChange={(e) => set('bio_line', e.target.value)} maxLength={240} hint="מופיע בעמוד ההרשמה ליד השם (רק אחרי אישור)." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="טלפון" ltr type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
          <Input label="קישור (אינסטגרם, לינקדאין, אתר)" ltr type="url" placeholder="https://" value={f.social_url} onChange={(e) => set('social_url', e.target.value)} error={errors.social_url} maxLength={300} />
        </div>
        <Textarea label="הערות לצוות" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} rows={3} />
        {!speaker && (admin ? (
          <Checkbox label="לאשר מיד" hint="מרצה מאושר/ת אפשר לשבץ במפגש ולהציג בעמוד ההרשמה." checked={f.approve} onChange={(v) => set('approve', v)} />
        ) : (
          <Notice icon="shield">יופיע/תופיע ב"הצעות ממתינות" עד שמנהל/ת יאשר/תאשר.</Notice>
        ))}
        {formError && <p className="text-sm font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
