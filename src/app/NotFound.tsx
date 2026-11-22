import { useLocation } from 'react-router';
import { useRole } from '@/lib/auth';
import { useTitle } from '@/lib/title';
import { ButtonLink, EmptyState } from '@/ui/kit';

export function NotFound() {
  // inside the staff area the way back is the staff home, not the public site
  const staff = useLocation().pathname.startsWith('/app');
  const role = useRole();
  useTitle('העמוד לא נמצא');
  const back = !staff ? 'לעמוד הראשי' : role === 'volunteer' ? 'לרשימת הכניסה' : 'למסך הסקירה';
  return (
    <EmptyState icon="alert" titleAs="h1" title="העמוד לא נמצא" action={<ButtonLink to={staff ? '/app' : '/'} cta>{back}</ButtonLink>}>
      ייתכן שהקישור ישן או שהוקלד לא נכון.
    </EmptyState>
  );
}
