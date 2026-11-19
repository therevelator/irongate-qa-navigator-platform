import React, { useCallback, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import API_URL from '../config/api';
import { ExportCsvButton } from './ExportCsvButton';
import { Page, PageIntro } from './ui';
import UserActivityList, { type ActivityFacets, type ActivityLoader } from './UserActivityList';
import { activityParams, emptyActivityFilters } from '../lib/userActivityFilters';

/**
 * User activity (super admins of the company): every sign-in, failed sign-in, view, change,
 * export and API ingestion request of the company's users, for 90 days
 * (GET /api/activity/log, server/lib/userActivity.ts). Next to the change history (Activity).
 */
const UserActivity: React.FC = () => {
  const [facets, setFacets] = useState<ActivityFacets | null>(null);
  const [filters, setFilters] = useState(emptyActivityFilters);

  useEffect(() => {
    fetch(`${API_URL}/activity/log/facets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null)).then((f) => f && setFacets(f)).catch(() => undefined);
  }, []);

  const load: ActivityLoader = useCallback(async (p) => {
    const res = await fetch(`${API_URL}/activity/log?${p.toString()}`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Could not load the user activity (${res.status})`);
    return body;
  }, []);

  return (
    <Page>
      <PageIntro
        title="User activity"
        description="Sign-ins, screens opened, data viewed, changes, exports and API ingestion of everyone in your organisation."
        actions={<ExportCsvButton what="User activity" href={`${API_URL}/activity/log.csv?${activityParams(filters).toString()}`} />}
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100" data-testid="user-activity-notice">
        <Info size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p>
          Every action by your users is recorded for 90 days. Let your staff know (for example in your privacy notice for employees).
          Only super admins see this page. Contents of forms, passwords and survey answers are never recorded.
        </p>
      </div>
      <UserActivityList load={load} facets={facets} filters={filters} onFiltersChange={setFilters} />
    </Page>
  );
};

export default UserActivity;
