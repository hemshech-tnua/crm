import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTemplates } from '@/lib/data';
import { renderTemplate, type TemplateContext } from '@/lib/templates';
import { whatsappLink, formatPhone } from '@/lib/phone';
import type { Template } from '@/lib/types';
import { Dialog, useCopy, useToast } from './feedback';
import { Button, Notice, Select, Textarea, buttonClass } from './kit';
import { Icon } from './Icon';

export type Recipient = { id: string; full_name: string | null; phone: string | null; consent_updates: boolean };

/** Logs a sent message in the participant's contact history. Fire-and-forget from the click handler. */
export function useLogContact() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (row: { participant_id: string; channel: 'whatsapp' | 'phone' | 'in_person' | 'other'; template_key?: string | null; summary?: string | null; event_id?: string | null; follow_up_id?: string | null }) => {
      const { data: s } = await supabase.auth.getSession();
      const { error } = await supabase.from('contact_log').insert({ ...row, created_by: s.session?.user.id });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['contact_log', v.participant_id] });
      qc.invalidateQueries({ queryKey: ['messages_sent'] });
    },
    onError: () => toast.error('ההודעה נפתחה, אבל הרישום שלה בהיסטוריה נכשל.'),
  });
}

/** Marketing templates need the participant's consent (Communications Law §30A). Calls are always allowed. */
export const allowedFor = (t: Template | undefined, r: Recipient) => !t?.is_marketing || r.consent_updates;

/**
 * Pick a template, edit the text, open WhatsApp on this phone with the text ready, and log it.
 * Nothing is ever sent automatically: a person presses "send" in WhatsApp.
 */
export function MessageComposer({ open, onClose, recipient, context, templateKeys, defaultKey, eventId, followUpId, onSent }: {
  open: boolean;
  onClose: () => void;
  recipient: Recipient;
  context: TemplateContext;
  templateKeys?: string[];
  defaultKey?: string;
  eventId?: string | null;
  followUpId?: string | null;
  onSent?: () => void;
}) {
  const templates = useTemplates();
  const log = useLogContact();
  const copy = useCopy();
  const list = useMemo(() => (templates.data ?? []).filter((t) => !templateKeys || templateKeys.includes(t.key)), [templates.data, templateKeys]);
  const [key, setKey] = useState(defaultKey ?? '');
  const [text, setText] = useState('');
  const tpl = list.find((t) => t.key === key);
  const firstName = recipient.full_name?.split(' ')[0] ?? '';

  useEffect(() => {
    if (!open) return;
    const k = key || defaultKey || list[0]?.key || '';
    if (k !== key) setKey(k);
    const t = list.find((x) => x.key === k);
    setText(t ? renderTemplate(t.body, { ...context, firstName }) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, list.length]);

  const allowed = tpl ? allowedFor(tpl, recipient) : true;
  const phone = recipient.phone;

  return (
    <Dialog open={open} onClose={onClose} title={`הודעה ל${recipient.full_name ?? ''}`}>
      <div className="flex flex-col gap-4">
        {list.length > 1 && (
          <Select label="תבנית" value={key} onChange={(e) => setKey(e.target.value)}>
            {list.map((t) => (
              <option key={t.key} value={t.key}>{t.label}{t.is_marketing ? ' (דורש הסכמה)' : ''}</option>
            ))}
          </Select>
        )}
        {!allowed ? (
          <Notice tone="warn" icon="alert">
            {recipient.full_name} לא אישר/ה לקבל עדכונים והזמנות. לפי חוק התקשורת אפשר לשלוח לו/ה הודעת וואטסאפ כזו רק אחרי הסכמה. אפשר להתקשר.
          </Notice>
        ) : (
          <Textarea label="הטקסט (אפשר לערוך לפני השליחה)" value={text} onChange={(e) => setText(e.target.value)} rows={7} />
        )}
        {!phone && <Notice tone="warn" icon="alert">אין מספר טלפון בכרטיס.</Notice>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {phone && allowed && (
          <a
            href={whatsappLink(phone, text)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('primary', 'md')}
            onClick={() => {
              log.mutate({ participant_id: recipient.id, channel: 'whatsapp', template_key: tpl?.key ?? null, event_id: eventId ?? null, follow_up_id: followUpId ?? null });
              onSent?.();
              onClose();
            }}
          >
            <Icon name="message" size={18} />
            פתיחה בוואטסאפ
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`} className={buttonClass('secondary', 'md')}>
            <Icon name="phone" size={18} />
            <span>חיוג</span>
            <span className="num text-sm text-muted">{formatPhone(phone)}</span>
          </a>
        )}
        {allowed && text && <Button variant="ghost" icon="copy" onClick={() => copy(text, 'הטקסט הועתק')}>העתקה</Button>}
      </div>
      <p className="mt-3 text-sm text-muted">ההודעה נשלחת מהוואטסאפ שלך, רק כשלוחצים "שליחה" שם. הפתיחה נרשמת בהיסטוריית הקשר של הלוחם/ת.</p>
    </Dialog>
  );
}
