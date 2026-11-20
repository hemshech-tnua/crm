// Sending in sequence ("שליחה ברצף"): every tap opens the chat of the person on screen, with their own text, and the
// contact history is logged on that same person's card. A regression here would send one person's message (and
// payment details) to the next person's number.
import { expect, test } from '@playwright/test';
import { makeEvent, name, phone, staff } from '../api/helpers';
import { loginAs, watchConsole } from './support';

test('send in sequence: each chat opens on the person shown, with their own name, and is logged on their card', async ({ page }) => {
  const errors = watchConsole(page);
  const coord = await staff('coord');
  const ev = await makeEvent({ title: `רצף הודעות E2E ${Date.now().toString(36)}`, startsInMinutes: 60 * 24 });
  const people: { id: string; full: string; phone: string }[] = [];
  for (let n = 0; n < 3; n++) {
    const full = name();
    const ph = phone();
    const { data: p } = await coord.from('participants').insert({ full_name: full, phone: ph, created_via: 'import' }).select('id').single();
    await coord.rpc('staff_register', { p_event_id: ev.id, p_participant_id: p!.id });
    people.push({ id: p!.id, full, phone: ph });
  }

  // record what the browser is asked to open instead of opening WhatsApp
  await page.addInitScript(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url?: string | URL) => { (window as unknown as { opened: string[] }).opened.push(String(url)); return null; }) as typeof window.open;
  });
  await loginAs(page, 'coord');
  await page.goto(`#/app/events/${ev.id}?tab=messages`);
  await page.getByRole('button', { name: /שליחה ברצף/ }).click();

  const dialog = page.getByRole('dialog');
  for (let n = 0; n < 3; n++) {
    const title = (await dialog.getByRole('heading').first().innerText()).replace(/^הודעה ל/, '').trim();
    const who = people.find((x) => x.full === title)!;
    expect(who, `dialog for an unknown person: ${title}`).toBeTruthy();
    await expect(dialog.getByLabel('הטקסט (אפשר לערוך לפני השליחה)')).toHaveValue(new RegExp(who.full.split(' ')[0]));
    await dialog.getByRole('link', { name: /^פתיחה בוואטסאפ/ }).click();
    const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
    const url = new URL(opened[n]);
    const digits = who.phone.replace(/\D/g, '').replace(/^0/, '972');
    expect(url.pathname.replace(/\D/g, ''), `chat ${n + 1} must open ${who.full}'s number`).toBe(digits);
    expect(decodeURIComponent(url.searchParams.get('text') ?? '')).toContain(who.full.split(' ')[0]);
  }
  await expect(dialog).toBeHidden();

  // each person's card holds exactly one WhatsApp contact, for this meeting
  for (const who of people) {
    await expect.poll(async () => {
      const { count } = await coord.from('contact_log').select('id', { count: 'exact', head: true })
        .eq('participant_id', who.id).eq('event_id', ev.id).eq('channel', 'whatsapp');
      return count;
    }).toBe(1);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
