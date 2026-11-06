import { useMe } from '@/lib/auth';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/labels';
import { ButtonLink, KeyValue, Panel } from '@/ui/kit';

export function AccountSettings() {
  const me = useMe();
  if (!me.data) return null;
  return (
    <Panel title="החשבון שלי">
      <KeyValue items={[
        ['שם', me.data.full_name],
        ['אימייל', <span key="e" className="num" dir="ltr">{me.data.email}</span>],
        ['תפקיד', `${ROLE_LABEL[me.data.role]}: ${ROLE_HINT[me.data.role]}`],
      ]} />
      <div className="mt-5"><ButtonLink to="/password" variant="secondary" icon="shield">החלפת סיסמה</ButtonLink></div>
      <p className="mt-3 text-sm text-muted">משתמשים במכשיר משותף? בסוף העבודה לוחצים "יציאה". המערכת מנתקת לבד אחרי 12 שעות בלי פעילות.</p>
    </Panel>
  );
}
