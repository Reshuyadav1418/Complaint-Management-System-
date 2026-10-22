import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { UsersTab } from './UsersTab.jsx';
import { RolesTab } from './RolesTab.jsx';
import { DepartmentsTab } from './DepartmentsTab.jsx';
import { ActivityTab } from './ActivityTab.jsx';

const TABS = [
  { key: 'users', label: 'Users', any: ['users.manage'], Component: UsersTab },
  { key: 'roles', label: 'Roles and permissions', any: ['roles.manage', 'users.manage'], Component: RolesTab },
  { key: 'departments', label: 'Departments', any: ['departments.manage'], Component: DepartmentsTab },
  { key: 'activity', label: 'Activity', any: ['audit.view'], Component: ActivityTab },
];

export function UsersRolesPage() {
  const { canAny } = useAuth();
  const tabs = TABS.filter((t) => canAny(...t.any));
  const [params, setParams] = useSearchParams();
  const active = tabs.find((t) => t.key === params.get('tab')) || tabs[0];

  return (
    <>
      <PageHeader title="Users and roles" description="Who can sign in, what each role may do, and which department people belong to." />
      <div role="tablist" aria-label="Administration sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={t.key === active.key}
            onClick={() => setParams({ tab: t.key })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 font-medium ${
              t.key === active.key ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <active.Component />
      </div>
    </>
  );
}
