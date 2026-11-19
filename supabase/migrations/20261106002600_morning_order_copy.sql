-- The Friday morning runs: workout, then coffee and snacks, then the guest lecture. The reminder and the
-- next-meeting invitation listed it in the old order (lecture before breakfast). Each template changes only while it
-- still holds the earlier default text, so a template an admin already edited in Settings is left alone.
-- Safe to run more than once.

update public.message_templates
   set body = 'היי {שם_פרטי}, תזכורת: ב{תאריך} ב-{שעה} נפגשים ב{מקום}.' || E'\n' ||
              '{פעילות}, קפה ונשנושים והרצאה של {מרצה} על {נושא}.' || E'\n' ||
              'אם לא מתאים לך להגיע, נשמח לעדכון כאן כדי שנפנה את המקום למי שמחכה.'
 where key = 'reminder'
   and body = 'היי {שם_פרטי}, תזכורת: ב{תאריך} ב-{שעה} נפגשים ב{מקום}.' || E'\n' ||
              '{פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וזמן ביחד.' || E'\n' ||
              'אם לא מתאים לך להגיע, נשמח לעדכון כאן כדי שנפנה את המקום למי שמחכה.';

update public.message_templates
   set body = 'היי {שם_פרטי}! ב{תאריך} נפגשים שוב: {פעילות}, קפה ונשנושים והרצאה של {מרצה} על {נושא}.' || E'\n' ||
              'להרשמה: {קישור_הרשמה}'
 where key = 'invite_next'
   and body = 'היי {שם_פרטי}! ב{תאריך} נפגשים שוב: {פעילות}, הרצאה של {מרצה} על {נושא}, ארוחת בוקר וחברים.' || E'\n' ||
              'להרשמה: {קישור_הרשמה}';
