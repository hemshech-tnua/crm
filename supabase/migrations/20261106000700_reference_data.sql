-- Reference data: the site, settings, acquisition sources and WhatsApp message templates.
-- These are production defaults taken from the questionnaire (not demo data); admins edit them in Settings.

grant execute on function private.assert_role(text[]) to authenticated;
grant execute on function private.local_today() to authenticated;

insert into public.sites (id, name, address)
values ('00000000-0000-4000-8000-000000000001', 'הולמס פלייס מודיעין', 'הולמס פלייס, מודיעין');

insert into public.settings (id, default_site_id, default_capacity)
values (true, '00000000-0000-4000-8000-000000000001', 40);

insert into public.acquisition_sources (key, label, is_friend, asks_detail, sort_order) values
  ('instagram',         'אינסטגרם',                          false, false, 10),
  ('whatsapp_group',    'קבוצת וואטסאפ',                     false, false, 20),
  ('friend',            'חבר/ה סיפר/ה לי או הביא/ה אותי',     true,  false, 30),
  ('facebook',          'פייסבוק',                           false, false, 40),
  ('organization',      'ארגון או גורם מקצועי',              false, true,  50),
  ('previous_activity', 'כבר הייתי בפעילות של העמותה',        false, false, 60),
  ('other',             'אחר',                               false, true,  90);

-- Placeholders: {שם_פרטי} {שם_המפגש} {תאריך} {שעה} {מקום} {פעילות} {מרצה} {נושא} {קישור_הרשמה} {קישור_משוב}
insert into public.message_templates (key, label, audience, is_marketing, sort_order, body) values
  ('confirmation', 'אישור הרשמה', 'registered', false, 10,
   'היי {שם_פרטי}, ההרשמה ל{שם_המפגש} ב{תאריך} בשעה {שעה} נקלטה. נפגשים ב{מקום}. מחכים לך!' || E'\n' ||
   'אם משהו משתנה, אפשר לענות להודעה הזו.'),
  ('reminder', 'תזכורת (יום חמישי)', 'registered', false, 20,
   'היי {שם_פרטי}, תזכורת: מחר, {תאריך}, ב-{שעה} נפגשים ב{מקום}.' || E'\n' ||
   '{פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וזמן ביחד.' || E'\n' ||
   'אם לא מתאים לך להגיע, נשמח שתעדכן/י כאן כדי שנפנה את המקום למי שמחכה.'),
  ('thanks', 'תודה + משוב אחרי המפגש', 'attended', false, 30,
   '{שם_פרטי}, תודה שהיית איתנו ב{שם_המפגש}! נשמח לשמוע איך היה, זה לוקח דקה: {קישור_משוב}'),
  ('missed_you', 'חסרת לנו', 'no_show', false, 40,
   'היי {שם_פרטי}, חסרת לנו ב{שם_המפגש} ב{תאריך}. הכול בסדר? נשמח לראות אותך בפעם הבאה.'),
  ('waitlist_promoted', 'התפנה מקום', 'waitlisted', false, 50,
   'היי {שם_פרטי}, התפנה מקום ב{שם_המפגש} ב{תאריך}, ואת/ה רשום/ה! מחכים לך ב-{שעה} ב{מקום}.'),
  ('invite_next', 'הזמנה למפגש הבא', 'consented', true, 60,
   'היי {שם_פרטי}! ב{תאריך} נפגשים שוב: {פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וחברים.' || E'\n' ||
   'להרשמה: {קישור_הרשמה}'),
  ('lapsed', 'מזמן לא התראינו', 'participant', true, 70,
   'היי {שם_פרטי}, מזמן לא ראינו אותך במפגשים ורצינו לשאול מה שלומך. נשמח לראות אותך: {קישור_הרשמה}');
