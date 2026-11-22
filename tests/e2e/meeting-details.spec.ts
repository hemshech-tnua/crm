// "כל הפרטים על המפגש": the trigger appears only where the view adds something; #/e/<code> shows the people of the
// meeting (photo from the Storage bucket under the real CSP, «קראו עוד» toggle); on #/r the same view opens as a sheet
// (?d=1) that the phone's back button closes without losing what was typed; staff upload and remove the photo.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makeEvent, staff } from '../api/helpers';
import { API_URL } from '../api/env';
import { loginAs, watchConsole } from './support';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PHOTO = readFileSync(new URL('../../src/assets/photos/hills.webp', import.meta.url));
const LONG_ABOUT = 'פסקה ראשונה על האדם, עם כמה משפטים שמספרים מה הוא עושה היום ואיפה. '.repeat(4)
  + '\n\nפסקה שנייה, שמופיעה רק אחרי «קראו עוד», עם עוד פרטים על הדרך שעבר עד כה.';

async function presenter(kind: 'speaker' | 'instructor', extra: Record<string, unknown> = {}) {
  const admin = await staff('admin');
  const tag = randomUUID().slice(0, 8).replace(/\d/g, (d) => 'אבגדהוזחטי'[+d]);
  const { data, error } = await admin.from('speakers').insert({
    kind, status: 'approved', full_name: kind === 'speaker' ? `מרצה דמו ${tag}` : `מדריך דמו ${tag}`, topic: 'נושא דמו', ...extra,
  }).select('id, full_name').single();
  if (error) throw error;
  return data as { id: string; full_name: string };
}

/** A meeting with an approved instructor (no photo: initials) and an approved speaker with a photo in the bucket. */
async function meetingWithPeople() {
  const coord = await staff('coord');
  const sp = await presenter('speaker', { role_label: 'מרצה אורחת', bio_line: 'שורה קצרה על המרצה.', about: LONG_ABOUT });
  const path = `${sp.id}-${Date.now()}.webp`;
  const up = await coord.storage.from('people').upload(path, new Blob([PHOTO], { type: 'image/webp' }), { contentType: 'image/webp' });
  if (up.error) throw up.error;
  await coord.from('speakers').update({ photo_path: path }).eq('id', sp.id);
  const ins = await presenter('instructor', { bio_line: 'שורה קצרה על המדריך.' });
  const ev = await makeEvent({
    title: 'מפגש פרטים E2E', activity_name: 'קרוספיט', instructor_id: ins.id, speaker_id: sp.id,
    lecture_topic: 'נושא ההרצאה לדמו', lecture_description: 'תיאור קצר של ההרצאה לדמו.', location: 'הולמס פלייס, מודיעין',
  });
  return { ev, sp, ins, path };
}

/** A public event as the list returns it, for checking where the trigger shows (the real list holds many test events). */
function fake(code: string, extra: Record<string, unknown> = {}) {
  const starts = new Date(Date.now() + 2 * 864e5);
  return {
    code, title: `מפגש ${code}`, type: 'friday', starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 9e6).toISOString(),
    location: 'הולמס פלייס, מודיעין', site_name: 'מודיעין', description: null, activity_name: 'יוגה', instructor_name: null, speaker_name: null,
    speaker_bio: null, lecture_topic: null, status: 'open', registration_open: true, is_full: false, spots_left: null, waitlist_enabled: true,
    lecture_description: null, people: [], ...extra,
  };
}
const withPerson = { people: [{ role: 'speaker', name: 'מרצה דמו', label: null, line: 'שורה קצרה.', about: null, photo_path: null }] };

async function listReturns(page: Page, events: unknown[]) {
  await page.route('**/rest/v1/rpc/public_list_events*', (route) => route.fulfill({ json: events }));
}

test('the trigger shows only when there are details, and not in the "עוד מפגשים" rows', async ({ page }) => {
  await listReturns(page, [fake('aaaa1111', withPerson), fake('bbbb2222', withPerson)]);
  await page.goto('#/?ref=ig');
  const trigger = page.getByTestId('details-trigger');
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toHaveText('כל הפרטים על המפגש');
  await expect(trigger).toHaveAttribute('href', '#/e/aaaa1111?ref=ig');
  // above the card's whole-surface link: a click lands on the trigger, not on the register button
  await trigger.click();
  await expect(page).toHaveURL(/#\/e\/aaaa1111\?ref=ig$/);

  await page.goto('#/friday');
  await expect(page.getByTestId('details-trigger')).toHaveAttribute('href', '#/e/aaaa1111');

  // nothing beyond the ticket: no trigger
  await page.unrouteAll();
  await listReturns(page, [fake('cccc3333', { people: [{ role: 'speaker', name: 'בלי פרטים', label: null, line: null, about: null, photo_path: null }] })]);
  await page.goto('#/');
  await page.reload(); // a hash change keeps the app (and its cached list): load it again
  await expect(page.getByRole('link', { name: /להרשמה/ })).toBeVisible();
  await expect(page.getByTestId('details-trigger')).toHaveCount(0);
  await page.goto('#/friday');
  await expect(page.getByTestId('friday-cta')).toBeVisible();
  await expect(page.getByTestId('details-trigger')).toHaveCount(0);
});

test('#/e/<code> shows who is with us, the lecture and the details, with a working «קראו עוד»', async ({ page }) => {
  const { ev, sp, ins, path } = await meetingWithPeople();
  const errors = watchConsole(page);
  await page.goto(`#/e/${ev.public_code}?ref=ig`);

  await expect(page.getByRole('heading', { level: 1, name: 'מפגש פרטים E2E' })).toBeVisible();
  await expect(page).toHaveTitle('פרטי המפגש: מפגש פרטים E2E · המשך תנועה');
  await expect(page.getByRole('heading', { level: 2, name: 'מי איתנו בבוקר' })).toBeVisible();
  const cards = page.getByTestId('person-card');
  await expect(cards).toHaveCount(2);
  // instructor first, with the neutral chip and initials; then the speaker with her label and photo
  await expect(cards.nth(0).getByRole('heading', { level: 3 })).toHaveText(ins.full_name);
  await expect(cards.nth(0)).toContainText('אימון קרוספיט');
  await expect(cards.nth(0).getByRole('img')).toHaveCount(0);
  await expect(cards.nth(1).getByRole('heading', { level: 3 })).toHaveText(sp.full_name);
  await expect(cards.nth(1)).toContainText('מרצה אורחת');
  const img = cards.nth(1).getByRole('img', { name: sp.full_name });
  await expect(img).toHaveAttribute('src', new RegExp(`/storage/v1/object/public/people/${path}$`));
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  // «קראו עוד»: four lines, then the rest
  const more = cards.nth(1).getByRole('button', { name: `קראו עוד על ${sp.full_name}` });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  const about = cards.nth(1).locator('p[id^="about-"]');
  const closedHeight = (await about.boundingBox())!.height;
  await more.click();
  const less = cards.nth(1).getByRole('button', { name: `פחות על ${sp.full_name}` });
  await expect(less).toHaveAttribute('aria-expanded', 'true');
  await expect(less).toHaveText('פחות');
  expect((await about.boundingBox())!.height).toBeGreaterThan(closedHeight);
  await less.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await expect(page.getByRole('heading', { level: 2, name: 'על ההרצאה' })).toBeVisible();
  await expect(page.getByText('תיאור קצר של ההרצאה לדמו.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'ככה נראה הבוקר' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'פרטים חשובים' })).toBeVisible();
  await expect(page.getByRole('link', { name: /ניווט ב-Waze/ })).toBeVisible();

  // the call to action keeps the referral
  const cta = page.getByTestId('details-cta').getByRole('link');
  await expect(cta).toHaveAttribute('href', `#/r/${ev.public_code}?ref=ig`);
  expect(errors).toEqual([]);

  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

test('#/e/<code>: an unknown code and a meeting without people', async ({ page }) => {
  await page.goto('#/e/zzzzzzzz');
  await expect(page.getByText('לא מצאנו את המפגש')).toBeVisible();
  const ev = await makeEvent({ title: 'בלי אנשים E2E', description: 'תיאור כללי של המפגש.' });
  await page.goto(`#/e/${ev.public_code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'בלי אנשים E2E' })).toBeVisible();
  // no people: the section is skipped, no placeholder
  await expect(page.getByRole('heading', { name: 'מי איתנו בבוקר' })).toHaveCount(0);
  await expect(page.getByTestId('person-card')).toHaveCount(0);
  await expect(page.getByText('תיאור כללי של המפגש.')).toBeVisible();
});

test('@phone the sheet on #/r opens with ?d=1, back closes it, and the typed form stays', async ({ page }) => {
  const { ev, sp } = await meetingWithPeople();
  const errors = watchConsole(page);
  await page.goto(`#/r/${ev.public_code}`);
  await page.getByLabel('שם מלא').fill('נועה בדיקה');

  const trigger = page.getByTestId('details-trigger');
  await trigger.click();
  await expect(page).toHaveURL(new RegExp(`#/r/${ev.public_code}\\?d=1$`));
  const sheet = page.getByRole('dialog', { name: 'כל הפרטים על המפגש' });
  await expect(sheet).toBeVisible();
  const close = sheet.getByRole('button', { name: /^סגירה/ });
  await expect(close).toBeFocused();
  const box = (await close.boundingBox())!;
  // rounded: sub-pixel layout can report 43.9999 for a 44px target
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  // full screen on a phone
  const vp = page.viewportSize()!;
  const sb = (await sheet.boundingBox())!;
  expect(Math.round(sb.width)).toBe(vp.width);
  await expect(sheet.getByTestId('person-card')).toHaveCount(2);
  await expect(sheet.getByRole('heading', { name: sp.full_name })).toBeVisible();
  // the page under it does not scroll
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');

  const r = await new AxeBuilder({ page }).include('dialog[open]').withTags(TAGS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);

  // the phone's back button closes it; the form is as it was, and focus is back on the trigger
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/r/${ev.public_code}$`));
  await expect(page.getByLabel('שם מלא')).toHaveValue('נועה בדיקה');
  await expect(trigger).toBeFocused();

  // Esc and «סגירה» close it too
  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/r/${ev.public_code}$`));
  await trigger.click();
  await sheet.getByRole('button', { name: /^סגירה/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByLabel('שם מלא')).toHaveValue('נועה בדיקה');

  // a shared link with ?d=1 opens straight into the sheet; closing it leaves the registration page
  await page.goto(`#/r/${ev.public_code}?d=1`);
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /^סגירה/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/r/${ev.public_code}$`));
  await expect(page.getByLabel('שם מלא')).toBeVisible();
  expect(errors).toEqual([]);
});

test('#/r shows no trigger when the meeting description is all there is', async ({ page }) => {
  const ev = await makeEvent({ title: 'רק תיאור E2E', description: 'תיאור שכבר מופיע בכרטיס.' });
  await page.goto(`#/r/${ev.public_code}`);
  await expect(page.getByLabel('שם מלא')).toBeVisible();
  await expect(page.getByTestId('details-trigger')).toHaveCount(0);
});

test('staff upload a photo for the meeting page, and removing it deletes the file', async ({ page }) => {
  const sp = await presenter('speaker');
  await loginAs(page, 'coord');
  await page.goto('#/app/speakers');
  const card = page.locator('li, article').filter({ hasText: sp.full_name }).last();
  await card.getByRole('button', { name: 'עריכה' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('מעלים רק תמונה שהאדם הסכים שתפורסם באתר.')).toBeVisible();
  await dialog.getByLabel('תיאור תפקיד בדף המפגש').fill('מרצה אורחת');
  await dialog.getByLabel('כמה מילים לדף המפגש').fill('כמה מילים לדמו.');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: PHOTO });
  const preview = dialog.getByRole('img', { name: `התמונה של ${sp.full_name}` });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'שמירה' }).click();
  await expect(dialog).toBeHidden();

  const admin = await staff('admin');
  const row = (await admin.from('speakers').select('role_label, about, photo_path').eq('id', sp.id).single()).data!;
  expect(row.role_label).toBe('מרצה אורחת');
  expect(row.about).toBe('כמה מילים לדמו.');
  expect(row.photo_path).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+\.(webp|jpg)$/);
  expect(row.photo_path).not.toContain(sp.id);
  // cropped to 4:5 and at most 800 wide
  const res = await fetch(`${API_URL}/storage/v1/object/public/people/${row.photo_path}`);
  expect(res.status).toBe(200);
  await card.getByRole('button', { name: 'עריכה' }).click();
  await expect(dialog.getByRole('img', { name: `התמונה של ${sp.full_name}` })).toBeVisible();
  // read back through the page (the app's own Supabase URL, so the CSP allows it)
  const size = await page.evaluate(async (p) => {
    const img = document.querySelector<HTMLImageElement>('img[src*="/storage/v1/object/public/people/"]');
    const base = img?.src.split('/storage/v1/object/public/people/')[0];
    const probe = new Image();
    probe.src = `${base}/storage/v1/object/public/people/${p}`;
    await probe.decode();
    return [probe.naturalWidth, probe.naturalHeight];
  }, row.photo_path as string);
  expect(size[0]).toBeLessThanOrEqual(800);
  expect(Math.abs(size[1] / size[0] - 1.25)).toBeLessThan(0.01);

  // remove: the field clears and the file goes on save
  await dialog.getByRole('button', { name: 'הסרת התמונה' }).click();
  await expect(dialog.getByText('התמונה תימחק בשמירה.')).toBeVisible();
  await dialog.getByRole('button', { name: 'שמירה' }).click();
  await expect(dialog).toBeHidden();
  expect((await admin.from('speakers').select('photo_path').eq('id', sp.id).single()).data!.photo_path).toBeNull();
  await expect.poll(async () => (await fetch(`${API_URL}/storage/v1/object/public/people/${row.photo_path}`)).status).not.toBe(200);
});
