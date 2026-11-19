import { DEMO_DATA_HEADER, isValidDemoDataToken, runDemoJob } from '../../server/lib/demoGenerate';

/**
 * Platform operator panel, "Demo Data" and "Populate metrics": the worker (Netlify Background
 * Function: the "-background" name gives it up to 15 minutes, and the caller gets 202 at once).
 * Started by the operator API (server/lib/demoGenerate.ts startDemoJob) with { jobId } and a token
 * signed for that job; a request without the right token does nothing. Runs the queued job once
 * (progress and outcome in demo_data_jobs and job_runs). Logs counts only.
 */
export default async (req: Request) => {
  let jobId = '';
  try {
    const body = await req.json().catch(() => ({}));
    jobId = typeof body?.jobId === 'string' ? body.jobId : '';
  } catch { /* no body */ }
  if (req.method !== 'POST' || !jobId || !isValidDemoDataToken(jobId, req.headers.get(DEMO_DATA_HEADER))) {
    console.warn('[demo-data-background] ignored a request without a valid token');
    return;
  }
  const job = await runDemoJob(jobId);
  console.log(`[demo-data-background] job ${jobId}: ${job ? `${job.status} ${JSON.stringify(job.result ?? {})}` : 'not queued (already started or unknown)'}`);
};
