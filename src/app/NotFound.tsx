import { useLocation } from 'react-router';
import { ButtonLink, EmptyState } from '@/ui/kit';

export function NotFound() {
  // inside the staff area the way back is the staff home, not the public site
  const staff = useLocation().pathname.startsWith('/app');
  return (
    <EmptyState icon="alert" title="העמוד לא נמצא" action={<ButtonLink to={staff ? '/app' : '/'} cta>{staff ? 'למסך הראשי' : 'לעמוד הראשי'}</ButtonLink>}>
      ייתכן שהקישור ישן או שהוקלד לא נכון.
    </EmptyState>
  );
}
