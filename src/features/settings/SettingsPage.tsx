import { useSearchParams } from 'react-router';
import { useRole } from '@/lib/auth';
import { PageHeader, Segmented, Tabs } from '@/ui/kit';
import { GeneralSettings } from './GeneralSettings';
import { PaymentWebhookPanel } from './PaymentWebhook';
import { UsersSettings } from './UsersSettings';
import { TemplatesSettings } from './TemplatesSettings';
import { SourcesSettings, SitesSettings } from './ListsSettings';
import { LinksSettings } from './LinksSettings';
import { PrivacySettings, AuditLog } from './PrivacySettings';
import { AccountSettings } from './AccountSettings';
import { SecuritySettings } from './SecuritySettings';

/** One section of the settings. The address keeps the section (?tab=users), so old links still open the right place. */
type Tab = 'general' | 'users' | 'templates' | 'sources' | 'links' | 'sites' | 'payments' | 'privacy' | 'audit' | 'security' | 'account';
type Group = { value: string; label: string; sections: { value: Tab; label: string }[] };

// Admins: the sections grouped by what they are about, so the row of tabs stays short.
const ADMIN_GROUPS: Group[] = [
  { value: 'general', label: 'יעדים וכללים', sections: [{ value: 'general', label: 'יעדים וכללים' }] },
  {
    value: 'team', label: 'צוות והרשאות', sections: [
      { value: 'users', label: 'משתמשים' },
      { value: 'security', label: 'אבטחה' },
      { value: 'audit', label: 'יומן פעולות' },
    ],
  },
  {
    value: 'outreach', label: 'הודעות והרשמה', sections: [
      { value: 'templates', label: 'הודעות וואטסאפ' },
      { value: 'links', label: 'קישורי הרשמה' },
      { value: 'sources', label: 'מקורות הגעה' },
      { value: 'sites', label: 'מתחמים' },
    ],
  },
  { value: 'payments', label: 'תשלומים', sections: [{ value: 'payments', label: 'תשלומים' }] },
  { value: 'privacy', label: 'פרטיות', sections: [{ value: 'privacy', label: 'פרטיות' }] },
  { value: 'account', label: 'החשבון שלי', sections: [{ value: 'account', label: 'החשבון שלי' }] },
];
const COORD_GROUPS: Group[] = [
  { value: 'links', label: 'קישורי הרשמה', sections: [{ value: 'links', label: 'קישורי הרשמה' }] },
  { value: 'account', label: 'החשבון שלי', sections: [{ value: 'account', label: 'החשבון שלי' }] },
];

export function SettingsPage() {
  const role = useRole();
  const admin = role === 'admin';
  const [params, setParams] = useSearchParams();
  const groups = admin ? ADMIN_GROUPS : COORD_GROUPS;
  const requested = params.get('tab') as Tab | null;
  const group = groups.find((g) => g.sections.some((s) => s.value === requested)) ?? groups[0];
  const tab = group.sections.some((s) => s.value === requested) ? requested! : group.sections[0].value;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  return (
    <>
      <PageHeader title="הגדרות" subtitle={admin ? 'יעדים, צוות והרשאות, הודעות והרשמה, תשלומים ופרטיות.' : 'קישורי ההרשמה לפי ערוץ, והחשבון שלך.'} />
      <Tabs<string>
        label="הגדרות"
        value={group.value}
        onChange={(g) => setTab(groups.find((x) => x.value === g)!.sections[0].value)}
        tabs={groups.map((g) => ({ value: g.value, label: g.label }))}
      />
      {group.sections.length > 1 && (
        <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented<Tab> label={group.label} value={tab} onChange={setTab} options={group.sections} />
        </div>
      )}
      {tab === 'general' && <GeneralSettings />}
      {tab === 'users' && <UsersSettings />}
      {tab === 'templates' && <TemplatesSettings />}
      {tab === 'links' && <LinksSettings />}
      {tab === 'sources' && <SourcesSettings />}
      {tab === 'sites' && <SitesSettings />}
      {tab === 'payments' && <PaymentWebhookPanel />}
      {tab === 'privacy' && <PrivacySettings />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'security' && <SecuritySettings />}
      {tab === 'account' && <AccountSettings />}
    </>
  );
}
