import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useReferralLinks, useSettings, useSources, type EventWithStats } from '@/lib/data';
import { fmtDayLong, fmtTime, ilParts } from '@/lib/dates';
import { registerUrl } from '@/lib/links';
import { downloadFile } from '@/lib/csv';
import type { ReferralLink } from '@/lib/types';
import { Button, ButtonLink, Checkbox, Input, Notice, Panel, Select, cx } from '@/ui/kit';
import { useCopy, useToast } from '@/ui/feedback';
import type { EventPeople } from './context';
import {
  POST_SIZE, canvasToPng, drawPost, instagramCaption, loadImage, loadPostFonts, programItems, whatsappGroupMessage,
  type CaptionInput, type PostContent, type PostFormat, type PostLayout, type PostTheme,
} from './marketing';
import { PHOTOS, photoFor } from './photos';

const CTA_OPTIONS = ['נרשמים בקישור בביו', 'נרשמים בקישור', 'המקומות מוגבלים, נרשמים בקישור'];
const KICKERS: Record<string, string> = { friday: 'בואו איתנו', bonfire: 'בואו איתנו', other: 'בואו איתנו' };
const LAYOUTS: { value: PostLayout; label: string; hint: string }[] = [
  { value: 'photo', label: 'צילום', hint: 'תוכן קצר על צילום' },
  { value: 'shapes', label: 'צורות', hint: 'בלי צילום, הצורות נושאות את המסר' },
  { value: 'program', label: 'תוכנייה', hint: 'הרבה תוכן: מתי, איפה, מה ומי' },
];
const FORMATS: { value: PostFormat; label: string; size: string; aspect: string }[] = [
  { value: 'portrait', label: 'פוסט', size: '1080×1350', aspect: 'aspect-[4/5]' },
  { value: 'square', label: 'פוסט ריבועי', size: '1080×1080', aspect: 'aspect-square' },
  { value: 'story', label: 'סטורי', size: '1080×1920', aspect: 'aspect-[9/16]' },
];
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
    kicker: KICKERS[e.type] ?? '',
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
  const [theme, setTheme] = useState<PostTheme>('navy');
  const [layout, setLayout] = useState<PostLayout>('photo');
  const [photoKey, setPhotoKey] = useState<string>(() => photoFor(e.type).key);
  const [ownPhoto, setOwnPhoto] = useState<string | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const picked = PHOTOS.find((x) => x.key === photoKey) ?? PHOTOS[0];
  const photoUrl = ownPhoto ?? picked.url;
  useEffect(() => {
    let alive = true;
    loadImage(photoUrl).then((img) => { if (alive) setPhoto(img); }, () => { if (alive) setPhoto(null); });
    return () => { alive = false; };
  }, [photoUrl]);
  // a photograph picked from the device stays on the device: drawn from a local blob, never uploaded
  useEffect(() => () => { if (ownPhoto) URL.revokeObjectURL(ownPhoto); }, [ownPhoto]);
  const [withLink, setWithLink] = useState(false);
  const content: PostContent = { ...defaults, ...edits };

  // channel links (so the reports know where registrations came from): suggested per channel, changeable
  const active = useMemo(() => [...(links.data ?? [])].filter((l) => l.is_active).sort((a, b) => a.created_at.localeCompare(b.created_at)), [links.data]);
  const suggest = (key: string, code: string, label: RegExp) => {
    const src = sources.data?.find((x) => x.key === key);
    const mine = active.filter((l) => src && l.source_id === src.id);
    return (mine.find((l) => l.code === code) ?? mine.find((l) => label.test(l.label)) ?? mine[0])?.id ?? '';
  };
  const [igPick, setIgPick] = useState<string | null>(null);
  const [waPick, setWaPick] = useState<string | null>(null);
  const igId = igPick ?? suggest('instagram', 'ig-bio', /ביו/);
  const waId = waPick ?? suggest('whatsapp_group', 'wa-group', /קבוצ/);
  const igLink = active.find((l) => l.id === igId);
  const waLink = active.find((l) => l.id === waId);
  const publicUrl = registerUrl(e.public_code, igLink?.code);
  const waUrl = registerUrl(e.public_code, waLink?.code);
  const shownLink = publicUrl.replace(/^https?:\/\//, '');
  const drawn: PostContent = { ...content, link: withLink ? shownLink : '' };

  const canvases = useRef<Partial<Record<PostFormat, HTMLCanvasElement | null>>>({});
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPostFonts().then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);

  const drawKey = JSON.stringify({ drawn, theme, layout });
  useEffect(() => {
    if (!fontsReady) return;
    const focus = ownPhoto ? { x: 0.5, y: 0.4 } : (PHOTOS.find((x) => x.key === photoKey) ?? PHOTOS[0]).focus;
    const c = JSON.parse(drawKey) as { drawn: PostContent; theme: PostTheme; layout: PostLayout };
    for (const f of FORMATS) {
      const canvas = canvases.current[f.value];
      if (canvas) drawPost(canvas, c.drawn, f.value, { layout: c.layout, theme: c.theme, photo, focus });
    }
  }, [fontsReady, drawKey, photo, ownPhoto, photoKey]);

  const download = async (format: PostFormat) => {
    const canvas = canvases.current[format];
    if (!canvas) return;
    try {
      const blob = await canvasToPng(canvas);
      const date = ilParts(e.starts_at).date;
      downloadFile(`hemshech-tnua-${format === 'story' ? 'story' : format === 'square' ? 'post-square' : 'post'}-${date}.png`, blob);
      toast.success(format === 'story' ? 'הסטורי ירד' : 'הפוסט ירד');
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

      <Panel title="עיצוב ההזמנה">
        <div className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">סוג העיצוב (לפי ספר המותג)</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {LAYOUTS.map((l) => (
                <Choice key={l.value} on={layout === l.value} onClick={() => setLayout(l.value)}>
                  <span className="font-bold">{l.label}</span>
                  <span className="text-sm font-normal text-muted">{l.hint}</span>
                </Choice>
              ))}
            </div>
          </fieldset>
          {layout === 'photo' && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">צילום</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
                {PHOTOS.map((ph) => (
                  <button
                    key={ph.key}
                    type="button"
                    aria-pressed={!ownPhoto && photoKey === ph.key}
                    onClick={() => { setOwnPhoto(null); setPhotoKey(ph.key); }}
                    className={cx('group relative overflow-hidden rounded-[var(--radius-control)] border-2 text-start', !ownPhoto && photoKey === ph.key ? 'border-ink' : 'border-transparent')}
                  >
                    <img src={ph.url} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
                    <span className="absolute inset-x-0 bottom-0 bg-ink/85 px-1.5 py-1 text-[0.75rem] font-semibold text-light">{ph.label}</span>
                  </button>
                ))}
                <label className={cx('flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border-2 border-dashed p-1 text-center text-[0.8rem] font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink', ownPhoto ? 'border-ink bg-sky' : 'border-line bg-paper')}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(x) => {
                      const f = x.target.files?.[0];
                      if (f && f.size < 25_000_000) setOwnPhoto(URL.createObjectURL(f));
                      x.target.value = '';
                    }}
                  />
                  <span>בחירה מהמכשיר</span>
                </label>
              </div>
              <p className="mt-1.5 text-sm text-muted">הצילומים כאן הם הדמיה שנוצרה לעמותה. צילום אמיתי של הלוחמים והלוחמות שלנו תמיד עדיף. צילום מהמכשיר נשאר במכשיר ולא עולה לשום מקום.</p>
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">צבע הרקע</legend>
            <div className="flex gap-2">
              {(['navy', 'beige'] as PostTheme[]).map((t) => (
                <Choice key={t} on={theme === t} onClick={() => setTheme(t)} row>
                  <span className={cx('h-5 w-5 rounded-[2px] border border-ink/40', t === 'navy' ? 'bg-ink' : 'bg-light')} aria-hidden="true" />
                  {t === 'navy' ? 'כחול כהה' : 'בז׳'}
                </Choice>
              ))}
            </div>
          </fieldset>
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <Panel title="מה כתוב בהזמנה">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-3">
              <Input label="שורה מעל" value={content.kicker} onChange={(x) => set('kicker', x.target.value)} maxLength={24} />
              <Input label="כותרת" hint="עד חמש מילים" value={content.title} onChange={(x) => set('title', x.target.value)} maxLength={40} />
            </div>
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
            {Object.keys(edits).length > 0 && (
              <div><Button variant="ghost" size="sm" icon="undo" onClick={() => setEdits({})}>חזרה לפרטי המפגש</Button></div>
            )}
          </div>
        </Panel>

        <Panel title="תצוגה מקדימה">
          {!fontsReady && <p className="mb-2 text-sm text-muted">טוען גופנים…</p>}
          <div className="grid grid-cols-[1fr_1fr_0.72fr] items-start gap-3">
            {FORMATS.map((f) => (
              <figure key={f.value} className="flex flex-col gap-2">
                <canvas
                  ref={(el) => { canvases.current[f.value] = el; }}
                  width={POST_SIZE[f.value].w}
                  height={POST_SIZE[f.value].h}
                  className={cx(f.aspect, 'h-auto w-full rounded-[2px] shadow-sm')}
                  role="img"
                  aria-label={`תצוגה מקדימה: ${f.label}`}
                />
                <figcaption className="text-center text-sm text-muted">{f.label} <span className="num">{f.size}</span></figcaption>
                <Button icon="download" size="sm" variant={f.value === 'portrait' ? 'primary' : 'secondary'} onClick={() => download(f.value)} disabled={!fontsReady} className="px-2">
                  {f.value === 'story' ? 'הורדת סטורי' : f.value === 'square' ? 'הורדת ריבועי' : 'הורדת פוסט'}
                </Button>
              </figure>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <CaptionPanel
          title="טקסט לאינסטגרם"
          text={igText}
          onCopy={() => copy(igText, 'הטקסט לאינסטגרם הועתק')}
          link={<LinkPick label="קישור לאינסטגרם (לביו ולתמונה)" value={igId} onChange={setIgPick} links={active} url={publicUrl} onCopy={() => copy(publicUrl, 'הקישור הועתק')} />}
        />
        <CaptionPanel
          title="הודעה לקבוצות וואטסאפ"
          text={waText}
          onCopy={() => copy(waText, 'ההודעה הועתקה')}
          link={<LinkPick label="קישור בהודעה" value={waId} onChange={setWaPick} links={active} url={waUrl} onCopy={() => copy(waUrl, 'הקישור הועתק')} />}
        />
      </div>
    </div>
  );
}

function CaptionPanel({ title, text, onCopy, link }: { title: string; text: string; onCopy: () => void; link: ReactNode }) {
  return (
    <Panel title={title} actions={<Button size="sm" icon="copy" onClick={onCopy}>העתקה</Button>}>
      <div className="max-h-80 overflow-y-auto rounded-[var(--radius-control)] bg-mist px-3.5 py-3 text-[0.95rem] leading-relaxed whitespace-pre-line select-all">{text}</div>
      <div className="mt-4">{link}</div>
    </Panel>
  );
}

/** Which registration link a channel uses: the general one or a channel link, so registrations are counted per channel. */
function LinkPick({ label, value, onChange, links, url, onCopy }: {
  label: string; value: string; onChange: (v: string) => void; links: ReferralLink[]; url: string; onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Select label={label} value={value} onChange={(x) => onChange(x.target.value)} hint={links.length ? undefined : 'אפשר ליצור קישור לכל ערוץ בלשונית "סקירה", כדי לדעת כמה נרשמו מכל ערוץ.'}>
        <option value="">הקישור הכללי</option>
        {links.map((l) => <option key={l.id} value={l.id}>{l.label} ({l.code})</option>)}
      </Select>
      <div className="flex items-center gap-2">
        <span dir="ltr" className="min-w-0 flex-1 truncate text-left text-sm text-muted">{url}</span>
        <Button size="sm" variant="ghost" icon="copy" onClick={onCopy}>העתקת הקישור</Button>
      </div>
    </div>
  );
}

function Choice({ on, onClick, children, row = false }: { on: boolean; onClick: () => void; children: ReactNode; row?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'flex min-h-11 rounded-[var(--radius-control)] border px-3.5 py-2 text-start font-semibold transition-colors',
        row ? 'items-center gap-2' : 'flex-col items-start gap-0.5',
        on ? 'border-ink bg-sky text-ink' : 'border-line bg-paper hover:border-ink/50',
      )}
    >
      {children}
    </button>
  );
}
