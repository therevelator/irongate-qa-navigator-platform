import { query } from '../../src/lib/db';

/**
 * Sample (demo) companies: the ONLY companies synthetic / randomly generated data may ever be
 * written to.
 *
 * The schema has no company-level "is demo" flag. A sample company is one created by the demo
 * generators, whose id carries the demo prefix: the demo seed's company is `demo-northwind`
 * (server/seeds/demoData.ts DEMO_COMPANY_ID, `npm run seed:demo`). Companies created by
 * registration or by a platform operator get a random UUID, so they can never match. Rows with a
 * 'demo-' id inside a real company (the operator's Demo Data, "Populate metrics") are sample ROWS
 * of a real company; that company is still real.
 *
 * Every synthetic generator (POST /api/analytics/update-daily, POST /api/analytics/seed-data, the
 * interval and pipeline generators in server/jobs, server/seeders/pipelineSeeder.ts) checks this, whatever ENABLE_SYNTHETIC_DATA says.
 */
export const SAMPLE_COMPANY_PREFIX = 'demo-';

export function isSampleCompanyId(companyId: unknown): companyId is string {
  return typeof companyId === 'string' && companyId.startsWith(SAMPLE_COMPANY_PREFIX) && companyId.length > SAMPLE_COMPANY_PREFIX.length;
}

/** SQL condition: the company id expression is a sample company. */
export const sampleCompanySql = (idExpr: string) => `(${idExpr} LIKE '${SAMPLE_COMPANY_PREFIX}%')`;

export class NotSampleCompanyError extends Error {
  constructor(companyId: unknown) {
    super(`Refusing to write synthetic data to company ${String(companyId)}: not a sample company`);
  }
}

/** Throws unless the company is a sample company (guard at the top of every synthetic writer). */
export function assertSampleCompany(companyId: unknown): asserts companyId is string {
  if (!isSampleCompanyId(companyId)) throw new NotSampleCompanyError(companyId);
}

/** Active sample companies (for the background generators). */
export async function activeSampleCompanyIds(): Promise<string[]> {
  const rows = await query<any>(`SELECT id FROM companies WHERE is_active = true AND ${sampleCompanySql('id')} ORDER BY id`);
  return rows.map((r: any) => r.id);
}
