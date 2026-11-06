import { useSearchParams } from 'react-router';
import { useRole } from '@/lib/auth';
import { PageHeader, Tabs } from '@/ui/kit';
import { GeneralSettings } from './GeneralSettings';
import { UsersSettings } from './UsersSettings';
import { TemplatesSettings } from './TemplatesSettings';
import { SourcesSettings, SitesSettings } from './ListsSettings';
import { LinksSettings } from './LinksSettings';
import { PrivacySettings, AuditLog } from './PrivacySettings';
import { AccountSettings } from './AccountSettings';

type Tab = 'general' | 'users' | 'templates' | 'sources' | 'links' | 'sites' | 'privacy' | 'audit' | 'account';

export function SettingsPage() {
  const role = useRole();
  const admin = role === 'admin';
  const [params, setParams] = useSearchParams();
  const tabs: { value: Tab; label: string }[] = admin
    ? [
        { value: 'general', label: 'יעדים וכללים' },
        { value: 'users', label: 'משתמשים' },
        { value: 'templates', label: 'הודעות וואטסאפ' },
        { value: 'links', label: 'קישורי הרשמה' },
        { value: 'sources', label: 'מקורות הגעה' },
        { value: 'sites', label: 'מתחמים' },
        { value: 'privacy', label: 'פרטיות' },
        { value: 'audit', label: 'יומן פעולות' },
        { value: 'account', label: 'החשבון שלי' },
      ]
    : [
        { value: 'links', label: 'קישורי הרשמה' },
        { value: 'account', label: 'החשבון שלי' },
      ];
  const requested = params.get('tab') as Tab | null;
  const tab = tabs.some((t) => t.value === requested) ? requested! : tabs[0].value;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  return (
    <>
      <PageHeader title="הגדרות" subtitle={admin ? 'יעדים, משתמשים, הודעות, מקורות ופרטיות.' : 'קישורי ההרשמה לפי ערוץ, והחשבון שלך.'} />
      <Tabs<Tab> label="הגדרות" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'general' && <GeneralSettings />}
      {tab === 'users' && <UsersSettings />}
      {tab === 'templates' && <TemplatesSettings />}
      {tab === 'links' && <LinksSettings />}
      {tab === 'sources' && <SourcesSettings />}
      {tab === 'sites' && <SitesSettings />}
      {tab === 'privacy' && <PrivacySettings />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'account' && <AccountSettings />}
    </>
  );
}
