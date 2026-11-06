import { ButtonLink, EmptyState } from '@/ui/kit';

export function NotFound() {
  return (
    <EmptyState icon="alert" title="העמוד לא נמצא" action={<ButtonLink to="/">לעמוד הראשי</ButtonLink>}>
      ייתכן שהקישור ישן או שהוקלד לא נכון.
    </EmptyState>
  );
}
