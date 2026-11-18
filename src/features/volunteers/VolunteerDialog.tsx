import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { formatPhone, normalizePhone } from '@/lib/phone';
import type { Volunteer, VolunteerRole } from '@/lib/types';
import { Button, Input, Textarea, cx } from '@/ui/kit';
import { Dialog, useToast } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { NOTES_GUIDANCE, nameError } from '@/features/participants/shared';
import { ROLE_LABEL, ROLE_ORDER } from './model';

/** Toggle chips for the roles a volunteer likes (also the picker's preference). */
export function RoleChips({ value, onChange, label }: { value: VolunteerRole[]; onChange: (v: VolunteerRole[]) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-small font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {ROLE_ORDER.map((r) => {
          const on = value.includes(r);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== r) : ROLE_ORDER.filter((x) => x === r || value.includes(x)))}
              className={cx(
                'inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 text-small font-medium transition-colors',
                on ? 'border-ink bg-ink text-light' : 'border-control-line text-ink-soft hover:border-ink hover:text-ink',
              )}
            >
              {on && <Icon name="check" size={15} />}
              {ROLE_LABEL[r]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Add a volunteer to the pool, or edit one. `onSaved` gets the id (the picker assigns a new volunteer at once). */
export function VolunteerDialog({ volunteer, onClose, onSaved, defaultRoles = [] }: {
  volunteer: Volunteer | null; onClose: () => void; onSaved?: (id: string, name: string) => void; defaultRoles?: VolunteerRole[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    full_name: volunteer?.full_name ?? '',
    phone: formatPhone(volunteer?.phone),
    roles: volunteer?.roles ?? defaultRoles,
    notes: volunteer?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const row = { full_name: f.full_name.trim(), phone: f.phone.trim() ? normalizePhone(f.phone) : null, roles: f.roles, notes: f.notes.trim() || null };
      if (volunteer) {
        const { error } = await supabase.from('volunteers').update(row).eq('id', volunteer.id);
        if (error) throw error;
        return volunteer.id;
      }
      const { data, error } = await supabase.from('volunteers').insert(row).select('id').single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['volunteers'] });
      if (!onSaved) toast.success(volunteer ? 'הפרטים נשמרו' : `${f.full_name.trim()} במאגר עכשיו`);
      onSaved?.(id, f.full_name.trim());
      onClose();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  const submit = () => {
    const next = {
      full_name: nameError(f.full_name),
      phone: f.phone.trim() && !normalizePhone(f.phone) ? 'מספר הטלפון לא נראה תקין. למשל: 050-1234567.' : null,
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
      title={volunteer ? `עריכה: ${volunteer.full_name}` : 'הוספה למאגר המתנדבים'}
      footer={<>
        <Button busy={save.isPending} onClick={submit}>{volunteer ? 'שמירה' : onSaved ? 'הוספה ושיבוץ' : 'הוספה למאגר'}</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="שם מלא" required autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} error={errors.full_name} maxLength={80} autoComplete="off" />
        <Input
          label="טלפון נייד"
          ltr
          type="tel"
          inputMode="tel"
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })}
          error={errors.phone}
          hint="בשביל הקישור האישי והתזכורות בוואטסאפ."
          autoComplete="off"
        />
        <RoleChips label="תפקידים מועדפים" value={f.roles} onChange={(roles) => setF({ ...f, roles })} />
        <Textarea label="הערות" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} rows={2} hint={`למשל: רק בשישי בבוקר. ${NOTES_GUIDANCE}`} />
        {formError && <p className="text-small font-medium text-bad" role="alert">{formError}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
