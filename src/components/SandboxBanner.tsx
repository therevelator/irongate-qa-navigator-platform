import React from 'react';
import { FlaskConical } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const PERSONA_LABEL: Record<string, string> = { cto: 'CTO', head_of_qa: 'Head of QA', team_lead: 'Team lead', engineer: 'Engineer' };

/**
 * The demo sandbox banner (/try; server/lib/sandbox.ts): on every page of a sandbox session, not
 * dismissible. Says it is sample data that resets every night, links to booking a demo and starting a
 * pilot, and back to /try to switch role. TV mode shows a one-line note in its footer instead (TeamTvView).
 */
const SandboxBanner: React.FC = () => {
  const { user } = useAuth();
  const sb = user?.sandbox;
  if (!sb) return null;
  const link = 'font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current rounded-sm';
  const who = `${user.firstName} ${user.lastName}${sb.persona ? ` (${PERSONA_LABEL[sb.persona] ?? sb.persona})` : ''}`;
  return (
    <div
      role="region"
      aria-label="Demo sandbox"
      data-testid="sandbox-banner"
      className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 sm:px-6 sm:text-sm"
    >
      <FlaskConical size={15} className="flex-shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Demo sandbox</span> — sample data, resets every night.{' '}
        <span className="text-amber-900">Viewing as {who}.</span>
      </p>
      <nav aria-label="Demo sandbox links" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={sb.bookDemoUrl} className={link} data-testid="sandbox-book-demo">Book a demo</a>
        <span aria-hidden="true">/</span>
        <a href={sb.startPilotUrl} className={link} data-testid="sandbox-start-pilot">Start a pilot</a>
        <a href="/try" className={`${link} font-medium`} data-testid="sandbox-switch">Switch role</a>
      </nav>
    </div>
  );
};

export default SandboxBanner;
