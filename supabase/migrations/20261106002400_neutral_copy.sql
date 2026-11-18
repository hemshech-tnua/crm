-- Participant-facing texts without slashed gender forms ("חבר/ה", "את/ה רשום/ה"), which read badly and are read
-- aloud as "slash" by screen readers. Each row changes only while it still holds the original default, so a text an
-- admin already edited in Settings is left alone. Safe to run more than once.

update public.acquisition_sources
   set label = 'חברים סיפרו לי או הביאו אותי'
 where key = 'friend' and label = 'חבר/ה סיפר/ה לי או הביא/ה אותי';

update public.message_templates
   set body = 'היי {שם_פרטי}, התפנה מקום ב{שם_המפגש} ב{תאריך}, וההרשמה שלך אושרה! מחכים לך ב-{שעה} ב{מקום}.'
 where key = 'waitlist_promoted'
   and body = 'היי {שם_פרטי}, התפנה מקום ב{שם_המפגש} ב{תאריך}, ואת/ה רשום/ה! מחכים לך ב-{שעה} ב{מקום}.';
