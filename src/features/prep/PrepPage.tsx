import { useSearchParams } from 'react-router';
import { PageHeader, Tabs } from '@/ui/kit';
import { WeekView } from './WeekView';
import { SuppliersView } from './SuppliersView';
import { TemplateView } from './TemplateView';

type Tab = 'week' | 'suppliers' | 'template';
const TABS: Tab[] = ['week', 'suppliers', 'template'];

/** #/app/prep: Itai's every-morning screen ("השבוע שלי"), the suppliers book and the standing checklist. */
export function PrepPage() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'week';
  const setTab = (t: Tab) => setSp(t === 'week' ? {} : { tab: t }, { replace: true });

  return (
    <div>
      <PageHeader title="הכנות" subtitle="מה צריך לעשות השבוע לקראת המפגשים, הספקים, והרשימה הקבועה." />
      <Tabs<Tab>
        label="הכנות"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'week', label: 'השבוע שלי' },
          { value: 'suppliers', label: 'ספקים' },
          { value: 'template', label: 'תבנית' },
        ]}
      />
      {tab === 'week' && <WeekView />}
      {tab === 'suppliers' && <SuppliersView />}
      {tab === 'template' && <TemplateView />}
    </div>
  );
}
