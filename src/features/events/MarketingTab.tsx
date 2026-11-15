import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useReferralLinks, useSettings, useSources, type EventWithStats } from '@/lib/data';
import { fmtDayLong, fmtTime, ilParts } from '@/lib/dates';
import { registerUrl } from '@/lib/links';
import { downloadFile } from '@/lib/csv';
import type { ReferralLink } from '@/lib/types';
import { Button, ButtonLink, Checkbox, Input, Notice, Panel, Segmented, Select, cx } from '@/ui/kit';
import { Tri } from '@/ui/Shapes';
import { Icon } from '@/ui/Icon';
import { useCopy, useToast } from '@/ui/feedback';
import type { EventPeople } from './context';
import {
  POST_SIZE, canvasToPng, drawPost, instagramCaption, loadImage, loadPostFonts, programItems, whatsappGroupMessage,
  type CaptionInput, type PostContent, type PostFormat, type PostLayout, type PostTheme,
} from './marketing';
import { DEVICE_ART, PHOTOS, photoFor } from './photos';

const CTA_OPTIONS = ['הירשמו בקישור בביו', 'הירשמו בקישור', 'שמרו לכם מקום בקישור'];
/** The headline is an action line (the book: up to five words, a verb); the event's name goes in the line above it. */
const TITLES: Record<string, string> = { friday: 'בואו להמשיך תנועה', bonfire: 'נפגשים סביב המדורה', other: 'בואו להמשיך תנועה' };
const LAYOUTS: { value: PostLayout; label: string; hint: string }[] = [
  { value: 'photo', label: 'צילום', hint: 'תוכן קצר על צילום' },
  { value: 'shapes', label: 'צורות', hint: 'בלי צילום, הצורות נושאות את המסר' },
  { value: 'program', label: 'תוכנייה', hint: 'הרבה תוכן: מתי, איפה, מה ומי' },
];
const FORMATS: { value: PostFormat; label: string; noun: string; file: string }[] = [
  { value: 'portrait', label: 'פוסט 4:5', noun: 'פוסט', file: 'post' },
  { value: 'square', label: 'ריבועי', noun: 'ריבועי', file: 'post-square' },
  { value: 'story', label: 'סטורי', noun: 'סטורי', file: 'story' },
];
const shortTime = (iso: string) => fmtTime(iso).replace(/^0/, '');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function MarketingTab({ event: e, people }: { event: EventWithStats; people: EventPeople }) {
  const settings = useSettings();
  const links = useReferralLinks();
  const sources = useSources();
  const copy = useCopy();
  const toast = useToast();
  const org = settings.data?.org_name ?? 'המשך תנועה';

  const defaults = useMemo<PostContent>(() => ({
    org,
    title: TITLES[e.type] ?? TITLES.other,
    kicker: e.title,
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
  const [format, setFormat] = useState<PostFormat>('portrait');
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
  // a link printed on the image is for typing: no protocol and no tracking query (nobody types "?ref=…")
  const shownLink = publicUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  // the image never says "the link is in the bio" right above a printed link
  const drawnCta = withLink && /בביו/.test(content.cta) ? 'הירשמו בקישור' : content.cta;
  const drawn: PostContent = { ...content, cta: drawnCta, link: withLink ? shownLink : '' };

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
    const art = ownPhoto ? DEVICE_ART : (PHOTOS.find((x) => x.key === photoKey) ?? PHOTOS[0]);
    const c = JSON.parse(drawKey) as { drawn: PostContent; theme: PostTheme; layout: PostLayout };
    for (const f of FORMATS) {
      const canvas = canvases.current[f.value];
      if (canvas) drawPost(canvas, c.drawn, f.value, { layout: c.layout, theme: c.theme, photo, art });
    }
  }, [fontsReady, drawKey, photo, ownPhoto, photoKey]);

  const date = ilParts(e.starts_at).date;
  const save = async (fmt: PostFormat) => {
    const canvas = canvases.current[fmt];
    if (!canvas) throw new Error('no canvas');
    const blob = await canvasToPng(canvas);
    downloadFile(`hemshech-tnua-${FORMATS.find((x) => x.value === fmt)!.file}-${date}.png`, blob);
  };
  const download = async (fmts: PostFormat[]) => {
    try {
      for (const f of fmts) await save(f);
      toast.success(fmts.length > 1 ? 'שלושת הקבצים ירדו' : fmts[0] === 'story' ? 'הסטורי ירד' : 'הפוסט ירד');
    } catch {
      toast.error('לא הצלחנו ליצור את התמונה. נסו שוב.');
    }
  };

  const cap: CaptionInput = {
    type: e.type,
    org,
    title: e.title,
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
  const titleWords = words(content.title);
  const current = FORMATS.find((f) => f.value === format)!;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {missingSpeaker && (
        <Notice tone="warn" icon="alert">
          {!people.speaker && !e.lecture_topic ? 'עוד לא נקבעו מרצה ונושא.' : !people.speaker ? 'עוד לא נקבע/ה מרצה.' : 'עוד לא נקבע נושא להרצאה.'}{' '}
          אפשר ליצור הזמנה גם עכשיו, אבל הזמנה עם מרצה ונושא מביאה יותר נרשמים.{' '}
          <ButtonLink to={`/app/events/${e.id}/edit`} variant="ghost" size="sm">עריכת המפגש</ButtonLink>
        </Notice>
      )}
      {people.speaker && people.speaker.status !== 'approved' && (
        <Notice tone="warn" icon="alert">{people.speaker.full_name} עדיין ממתין/ה לאישור. כדאי לאשר לפני שמפרסמים.</Notice>
      )}
      {e.status === 'draft' && <Notice tone="light" icon="alert">המפגש עדיין טיוטה. הקישור יעבוד רק אחרי פתיחת ההרשמה (בלשונית ״סקירה״).</Notice>}

      <p className="max-w-3xl text-body text-ink-soft">
        מכינים הזמנה בשלושה צעדים: בוחרים עיצוב, בודקים את הטקסט, מורידים ומפרסמים. מקבלים פוסט, סטורי וריבועי, טקסט לאינסטגרם והודעה לוואטסאפ.
      </p>

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr]">
        {/* 1 · design */}
        <Panel title="1 · עיצוב" className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-col gap-5">
            <fieldset>
              <legend className="mb-1.5 text-small font-medium">סוג העיצוב</legend>
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
                <legend className="mb-1.5 text-small font-medium">צילום</legend>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4 2xl:grid-cols-7">
                  {PHOTOS.map((ph) => {
                    const on = !ownPhoto && photoKey === ph.key;
                    return (
                      <button
                        key={ph.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => { setOwnPhoto(null); setPhotoKey(ph.key); }}
                        className={cx('relative overflow-hidden rounded-[var(--radius-control)] text-start outline-offset-2', on ? 'ring-[3px] ring-ink' : 'ring-1 ring-edge hover:ring-ink/50')}
                      >
                        <img src={ph.url} alt="" className={cx('aspect-[4/5] w-full object-cover', ph.mirror && '-scale-x-100')} loading="lazy" />
                        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-ink/85 px-1.5 py-1 text-[0.72rem] leading-tight font-semibold text-light">
                          {on && <Tri />}
                          {ph.label}
                        </span>
                      </button>
                    );
                  })}
                  <label className={cx(
                    'flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border p-1 text-center text-[0.78rem] leading-tight font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink',
                    ownPhoto ? 'border-solid border-ink bg-paper' : 'border-control-line bg-paper hover:border-ink',
                  )}>
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
                    {ownPhoto ? <Tri /> : <Icon name="image" size={22} />}
                    <span>בחירה מהמכשיר</span>
                  </label>
                </div>
                <p className="mt-1.5 text-sm text-muted">הצילומים כאן הם הדמיה שנוצרה לעמותה. צילום אמיתי של הלוחמים והלוחמות שלנו תמיד עדיף. צילום מהמכשיר נשאר במכשיר ולא עולה לשום מקום.</p>
              </fieldset>
            )}
            <fieldset>
              <legend className="mb-1.5 text-small font-medium">צבע הרקע</legend>
              <div className="flex flex-wrap gap-2">
                {(['navy', 'beige'] as PostTheme[]).map((t) => (
                  <Choice key={t} on={theme === t} onClick={() => setTheme(t)} row>
                    <span className={cx('h-5 w-5 rounded-[2px] border border-ink/50', t === 'navy' ? 'bg-ink' : 'bg-light')} aria-hidden="true" />
                    {t === 'navy' ? 'כחול כהה' : 'בז׳'}
                  </Choice>
                ))}
              </div>
            </fieldset>
          </div>
        </Panel>

        {/* the preview: right under step 1 on a phone, beside the steps (sticky) on a wide screen */}
        <section aria-label="תצוגה מקדימה" className="min-w-0 rounded-[var(--radius-panel)] border border-edge bg-paper p-4 sm:p-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-heading font-semibold">תצוגה מקדימה</h2>
            <Segmented label="גודל" options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} value={format} onChange={setFormat} />
          </div>
          {!fontsReady && <p className="mt-2 text-sm text-muted">טוען גופנים…</p>}
          <div className="mt-4 flex justify-center rounded-[var(--radius-control)] bg-mist p-3 sm:p-4">
            {FORMATS.map((f) => {
              const { w, h } = POST_SIZE[f.value];
              return (
                <div key={f.value} className={cx('min-w-0', f.value !== format && 'hidden')} style={{ width: `min(100%, calc(min(70vh, 760px) * ${w / h}))` }}>
                  <canvas
                    ref={(el) => { canvases.current[f.value] = el; }}
                    width={w}
                    height={h}
                    className="block h-auto w-full shadow-sm"
                    role="img"
                    aria-label={`תצוגה מקדימה: ${f.label}, ${w}×${h}`}
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-center text-sm text-muted"><span className="num" dir="ltr">{POST_SIZE[format].w}×{POST_SIZE[format].h}</span></p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button icon="download" onClick={() => download([format])} disabled={!fontsReady}>הורדת {current.noun}</Button>
            <Button icon="download" variant="ghost" onClick={() => download(FORMATS.map((f) => f.value))} disabled={!fontsReady}>הורדת שלושת הגדלים</Button>
          </div>
        </section>

        {/* 2 · text */}
        <Panel title="2 · טקסט" className="min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
              <Input label="שורה מעל" value={content.kicker} onChange={(x) => set('kicker', x.target.value)} maxLength={40} />
              <Input
                label="כותרת"
                hint={<span className={titleWords > 5 ? 'font-medium text-warn' : undefined}>{titleWords}/5 מילים</span>}
                value={content.title}
                onChange={(x) => set('title', x.target.value)}
                maxLength={40}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="תאריך" value={content.date} onChange={(x) => set('date', x.target.value)} maxLength={40} />
              <Input label="שעות" ltr value={content.time} onChange={(x) => set('time', x.target.value)} maxLength={20} />
            </div>
            <Input label="מה בתוכנית" hint="מפרידים בנקודה: יוגה · ארוחת בוקר" value={content.program} onChange={(x) => set('program', x.target.value)} maxLength={90} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="מרצה אורח/ת" value={content.speakerName} onChange={(x) => set('speakerName', x.target.value)} maxLength={60} />
              <Input label="מקום" value={content.place} onChange={(x) => set('place', x.target.value)} maxLength={60} />
            </div>
            <Input label="נושא ההרצאה" value={content.topic} onChange={(x) => set('topic', x.target.value)} maxLength={160} />
            <Select label="קריאה להרשמה" value={content.cta} onChange={(x) => set('cta', x.target.value)}>
              {CTA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
            {Object.keys(edits).length > 0 && (
              <div><Button variant="ghost" size="sm" icon="undo" onClick={() => setEdits({})}>חזרה לפרטי המפגש</Button></div>
            )}
          </div>
        </Panel>

        {/* 3 · publish, per channel */}
        <Panel title="3 · פרסום" className="min-w-0 lg:col-start-1 lg:row-start-3">
          <div className="flex flex-col gap-5">
            <Channel
              title="אינסטגרם"
              text={igText}
              onCopy={() => copy(igText, 'הטקסט לאינסטגרם הועתק')}
              copyLabel="העתקת הטקסט"
              link={<LinkPick label="קישור לביו ולתמונה" value={igId} onChange={setIgPick} links={active} url={publicUrl} onCopy={() => copy(publicUrl, 'הקישור הועתק')} />}
              extra={<Checkbox label="להוסיף את הקישור לתמונה" hint={<span dir="ltr" className="num break-all">{shownLink}</span>} checked={withLink} onChange={setWithLink} />}
              downloads={
                <>
                  <Button icon="download" variant="secondary" onClick={() => download(['portrait'])} disabled={!fontsReady}>הורדת פוסט</Button>
                  <Button icon="download" variant="secondary" onClick={() => download(['story'])} disabled={!fontsReady}>הורדת סטורי</Button>
                </>
              }
            />
            <Channel
              title="קבוצות וואטסאפ"
              text={waText}
              onCopy={() => copy(waText, 'ההודעה הועתקה')}
              copyLabel="העתקת ההודעה"
              link={<LinkPick label="קישור בהודעה" value={waId} onChange={setWaPick} links={active} url={waUrl} onCopy={() => copy(waUrl, 'הקישור הועתק')} />}
              downloads={<Button icon="download" variant="secondary" onClick={() => download(['square'])} disabled={!fontsReady}>הורדת ריבועי</Button>}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** One channel: its link, the text to paste and copy, and the image sizes that channel uses. */
function Channel({ title, text, onCopy, copyLabel, link, extra, downloads }: {
  title: string; text: string; onCopy: () => void; copyLabel: string; link: ReactNode; extra?: ReactNode; downloads: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[var(--radius-control)] border border-edge p-3.5 sm:p-4">
      <h3 className="text-body font-semibold">{title}</h3>
      <div className="mt-3 flex flex-col gap-3">
        {link}
        {extra}
        <div className="max-h-72 overflow-y-auto rounded-[var(--radius-control)] bg-mist px-3.5 py-3 text-[0.95rem] leading-relaxed break-words whitespace-pre-line select-all">{text}</div>
        <div className="flex flex-wrap gap-2">
          <Button icon="copy" onClick={onCopy}>{copyLabel}</Button>
          {downloads}
        </div>
      </div>
    </section>
  );
}

/** Which registration link a channel uses: the general one or a channel link, so registrations are counted per channel. */
function LinkPick({ label, value, onChange, links, url, onCopy }: {
  label: string; value: string; onChange: (v: string) => void; links: ReferralLink[]; url: string; onCopy: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Select label={label} value={value} onChange={(x) => onChange(x.target.value)} hint={links.length ? undefined : 'אפשר ליצור קישור לכל ערוץ בלשונית ״סקירה״, כדי לדעת כמה נרשמו מכל ערוץ.'}>
        <option value="">הקישור הכללי</option>
        {links.map((l) => <option key={l.id} value={l.id}>{l.label} ({l.code})</option>)}
      </Select>
      <div className="flex min-w-0 items-center gap-2">
        <span dir="ltr" className="min-w-0 flex-1 truncate text-left text-sm text-muted">{url}</span>
        <Button size="sm" variant="ghost" icon="copy" onClick={onCopy} className="shrink-0">העתקת הקישור</Button>
      </div>
    </div>
  );
}

/** A large choice: selected is told by a 2px navy frame, the weight and a leading ◀, not by colour alone. */
function Choice({ on, onClick, children, row = false }: { on: boolean; onClick: () => void; children: ReactNode; row?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'relative flex min-h-11 rounded-[var(--radius-control)] bg-paper py-2 text-start font-semibold text-ink transition-colors',
        row ? 'items-center gap-2' : 'flex-col items-start gap-0.5',
        on ? 'border-2 border-ink pe-[13px] ps-[30px]' : 'border border-control-line pe-3.5 ps-[31px] hover:border-ink',
      )}
    >
      {on && <Tri className={cx("absolute start-3", row ? "top-1/2 -translate-y-1/2" : "top-[1.05rem]")} />}
      {children}
    </button>
  );
}
