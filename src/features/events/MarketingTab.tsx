import { useEffect, useMemo, useRef, useState } from 'react';
import { useReferralLinks, useSettings, useSources, type EventWithStats } from '@/lib/data';
import { fmtDayLong, fmtTime, ilParts } from '@/lib/dates';
import { registerUrl } from '@/lib/links';
import { downloadFile } from '@/lib/csv';
import { Button, ButtonLink, Checkbox, Input, Notice, Panel, Select, cx } from '@/ui/kit';
import { useCopy, useToast } from '@/ui/feedback';
import type { EventPeople } from './context';
import {
  POST_SIZE, canvasToPng, drawPost, instagramCaption, loadPostFonts, programItems, whatsappGroupMessage,
  type CaptionInput, type PostContent, type PostFormat, type PostTheme,
} from './marketing';

const CTA_OPTIONS = ['הרשמה בקישור בביו', 'הרשמה בקישור', 'מספר המקומות מוגבל, נרשמים בקישור'];
const shortTime = (iso: string) => fmtTime(iso).replace(/^0/, '');

export function MarketingTab({ event: e, people }: { event: EventWithStats; people: EventPeople }) {
  const settings = useSettings();
  const links = useReferralLinks();
  const sources = useSources();
  const copy = useCopy();
  const toast = useToast();
  const org = settings.data?.org_name ?? 'המשך תנועה';

  const defaults = useMemo<PostContent>(() => ({
    org,
    title: e.title,
    date: fmtDayLong(e.starts_at),
    time: `${shortTime(e.starts_at)}–${shortTime(e.ends_at)}`,
    place: people.place ?? '',
    program: programItems(e.type, e.activity_name ?? '', !!people.speaker).join(' · '),
    speakerName: people.speaker?.full_name ?? '',
    topic: e.lecture_topic ?? '',
    cta: CTA_OPTIONS[0],
    link: '',
  }), [org, e, people.place, people.speaker]);

  const [edits, setEdits] = useState<Partial<PostContent>>({});
  const [theme, setTheme] = useState<PostTheme>('ink');
  const [withLink, setWithLink] = useState(false);
  const content: PostContent = { ...defaults, ...edits };

  // channel links: one for Instagram (bio), one for the WhatsApp groups, when they exist
  const channelLink = (key: string) => {
    const src = sources.data?.find((s) => s.key === key);
    return src ? (links.data ?? []).find((l) => l.is_active && l.source_id === src.id) : undefined;
  };
  const igLink = channelLink('instagram');
  const waLink = channelLink('whatsapp_group');
  const publicUrl = registerUrl(e.public_code, igLink?.code);
  const waUrl = registerUrl(e.public_code, waLink?.code);
  const shownLink = publicUrl.replace(/^https?:\/\//, '');
  const drawn: PostContent = { ...content, link: withLink ? shownLink : '' };

  const square = useRef<HTMLCanvasElement>(null);
  const story = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPostFonts().then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);

  const drawKey = JSON.stringify({ drawn, theme });
  useEffect(() => {
    if (!fontsReady) return;
    const c = JSON.parse(drawKey) as { drawn: PostContent; theme: PostTheme };
    if (square.current) drawPost(square.current, c.drawn, 'square', c.theme);
    if (story.current) drawPost(story.current, c.drawn, 'story', c.theme);
  }, [fontsReady, drawKey]);

  const download = async (format: PostFormat) => {
    const canvas = format === 'square' ? square.current : story.current;
    if (!canvas) return;
    try {
      const blob = await canvasToPng(canvas);
      const date = ilParts(e.starts_at).date;
      downloadFile(`hemshech-tnua-${format === 'square' ? 'post' : 'story'}-${date}.png`, blob);
      toast.success(format === 'square' ? 'הפוסט ירד' : 'הסטורי ירד');
    } catch {
      toast.error('לא הצלחנו ליצור את התמונה. נסו שוב.');
    }
  };

  const cap: CaptionInput = {
    type: e.type,
    org,
    title: content.title,
    date: content.date,
    time: content.time,
    place: content.place,
    activity: e.activity_name ?? '',
    speakerName: content.speakerName,
    topic: content.topic,
    description: e.description ?? '',
  };
  const igText = instagramCaption(cap, content.cta === CTA_OPTIONS[0] ? 'ההרשמה בקישור בביו.' : `להרשמה:\n${publicUrl}`);
  const waText = whatsappGroupMessage(cap, waUrl);

  const set = <K extends keyof PostContent>(k: K, v: PostContent[K]) => setEdits((x) => ({ ...x, [k]: v }));
  const missingSpeaker = e.type === 'friday' && (!people.speaker || !e.lecture_topic);

  return (
    <div className="flex flex-col gap-5">
      {missingSpeaker && (
        <Notice tone="warn" icon="alert">
          {!people.speaker && !e.lecture_topic ? 'עוד לא נקבעו מרצה ונושא.' : !people.speaker ? 'עוד לא נקבע/ה מרצה.' : 'עוד לא נקבע נושא להרצאה.'}{' '}
          אפשר ליצור פוסט גם עכשיו, אבל פוסט עם מרצה ונושא מביא יותר נרשמים.{' '}
          <ButtonLink to={`/app/events/${e.id}/edit`} variant="ghost" size="sm">עריכת המפגש</ButtonLink>
        </Notice>
      )}
      {people.speaker && people.speaker.status !== 'approved' && (
        <Notice tone="warn" icon="alert">{people.speaker.full_name} עדיין ממתין/ה לאישור. כדאי לאשר לפני שמפרסמים.</Notice>
      )}
      {e.status === 'draft' && <Notice tone="light" icon="alert">המפגש עדיין טיוטה. הקישור יעבוד רק אחרי פתיחת ההרשמה (בלשונית "סקירה").</Notice>}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Panel title="מה כתוב בתמונה">
          <div className="flex flex-col gap-4">
            <Input label="כותרת" value={content.title} onChange={(x) => set('title', x.target.value)} maxLength={40} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="תאריך" value={content.date} onChange={(x) => set('date', x.target.value)} maxLength={40} />
              <Input label="שעות" ltr value={content.time} onChange={(x) => set('time', x.target.value)} maxLength={20} />
            </div>
            <Input label="מה בתוכנית" value={content.program} onChange={(x) => set('program', x.target.value)} maxLength={90} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="מרצה אורח/ת" value={content.speakerName} onChange={(x) => set('speakerName', x.target.value)} maxLength={60} />
              <Input label="מקום" value={content.place} onChange={(x) => set('place', x.target.value)} maxLength={60} />
            </div>
            <Input label="נושא ההרצאה" value={content.topic} onChange={(x) => set('topic', x.target.value)} maxLength={160} />
            <Select label="קריאה להרשמה" value={content.cta} onChange={(x) => set('cta', x.target.value)}>
              {CTA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
            <Checkbox label="להוסיף את הקישור לתמונה" hint={<span dir="ltr" className="num">{shownLink}</span>} checked={withLink} onChange={setWithLink} />
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">רקע</legend>
              <div className="flex gap-2">
                {(['ink', 'mist'] as PostTheme[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={theme === t}
                    onClick={() => setTheme(t)}
                    className={cx('flex h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3.5 font-semibold', theme === t ? 'border-tide bg-tide-wash text-tide-deep' : 'border-line bg-paper')}
                  >
                    <span className={cx('h-5 w-5 rounded-full border border-line', t === 'ink' ? 'bg-ink' : 'bg-mist')} aria-hidden="true" />
                    {t === 'ink' ? 'כהה' : 'בהיר'}
                  </button>
                ))}
              </div>
            </fieldset>
            {Object.keys(edits).length > 0 && (
              <div><Button variant="ghost" size="sm" icon="undo" onClick={() => setEdits({})}>חזרה לפרטי המפגש</Button></div>
            )}
          </div>
        </Panel>

        <Panel title="תצוגה מקדימה">
          {!fontsReady && <p className="mb-2 text-sm text-muted">טוען גופנים…</p>}
          <div className="grid grid-cols-[1fr_0.5625fr] items-start gap-4">
            <figure className="flex flex-col gap-2">
              <canvas
                ref={square}
                width={POST_SIZE.square.w}
                height={POST_SIZE.square.h}
                className="aspect-square h-auto w-full rounded-lg shadow-sm"
                role="img"
                aria-label="תצוגה מקדימה של הפוסט"
              />
              <figcaption className="text-center text-sm text-muted">פוסט <span className="num">1080×1080</span></figcaption>
              <Button icon="download" onClick={() => download('square')} disabled={!fontsReady}>הורדת פוסט</Button>
            </figure>
            <figure className="flex flex-col gap-2">
              <canvas
                ref={story}
                width={POST_SIZE.story.w}
                height={POST_SIZE.story.h}
                className="aspect-[9/16] h-auto w-full rounded-lg shadow-sm"
                role="img"
                aria-label="תצוגה מקדימה של הסטורי"
              />
              <figcaption className="text-center text-sm text-muted">סטורי <span className="num">1080×1920</span></figcaption>
              <Button icon="download" variant="secondary" onClick={() => download('story')} disabled={!fontsReady} className="px-2">הורדת סטורי</Button>
            </figure>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <CaptionPanel title="טקסט לאינסטגרם" text={igText} onCopy={() => copy(igText, 'הטקסט לאינסטגרם הועתק')} note={igLink ? `בביו: קישור "${igLink.label}"` : undefined} />
        <CaptionPanel title="הודעה לקבוצות וואטסאפ" text={waText} onCopy={() => copy(waText, 'ההודעה הועתקה')} note={waLink ? `עם קישור "${waLink.label}", כדי לספור הרשמות מוואטסאפ` : 'אפשר ליצור קישור לערוץ וואטסאפ בלשונית "סקירה", כדי לדעת כמה נרשמו משם.'} />
      </div>
    </div>
  );
}

function CaptionPanel({ title, text, onCopy, note }: { title: string; text: string; onCopy: () => void; note?: string }) {
  return (
    <Panel title={title} actions={<Button size="sm" icon="copy" onClick={onCopy}>העתקה</Button>}>
      <div className="max-h-80 overflow-y-auto rounded-[var(--radius-control)] bg-mist px-3.5 py-3 text-[0.95rem] leading-relaxed whitespace-pre-line select-all">{text}</div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
    </Panel>
  );
}
