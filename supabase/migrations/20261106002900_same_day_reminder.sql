-- A reminder sent on the day of the meeting, next to the day-before reminder. Wording from the association (25 Nov 2026).
-- Adds one row only; an existing row with this key (e.g. edited in Settings) is left alone. Safe to run more than once.
-- Numbered before 20261106009000_privilege_hardening.sql, like the other data migrations; it grants nothing.

insert into public.message_templates (key, label, body, audience, is_marketing, sort_order)
values ('reminder_today', 'תזכורת ביום המפגש',
'היי {שם_פרטי}, מה העניינים?
רצינו להזכיר לך שהיום ניפגש ב{מקום} ב-{שעה}.
נשמח לעדכון הגעה סופי ממך, וכמובן שמזמינים להגיע עם עוד חברה!',
'registered', false, 21)
on conflict (key) do nothing;
