/**
 * Nightly demo refresh (netlify/functions/demo-refresh.ts + demo-refresh-background.ts,
 * server/lib/demoRefreshJob.ts). The refresh itself is covered by tests/database/demoRefresh.test.ts;
 * here it is mocked.
 *   NIGHTLY-001  the token is an HMAC of the secret, checked in constant time; no secret = no token
 *   NIGHTLY-002  the worker runs the refresh only for a POST with the right token, and not when off
 *   NIGHTLY-003  the scheduler calls the worker with the token, and does nothing when off or unconfigured
 */
const runRefreshDates = jest.fn();
jest.mock('../../server/seeds/demoSeed', () => ({ runRefreshDates: (...a: unknown[]) => runRefreshDates(...a) }));

import { demoRefreshToken, isValidDemoRefreshToken, DEMO_REFRESH_HEADER, DEMO_REFRESH_PATH } from '../../server/lib/demoRefreshJob';
import worker from '../../netlify/functions/demo-refresh-background';
import scheduler from '../../netlify/functions/demo-refresh';

const ENV_KEYS = ['DEMO_REFRESH_ENABLED', 'DEMO_REFRESH_SECRET', 'JWT_SECRET', 'URL', 'DEPLOY_PRIME_URL', 'APP_URL'];
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.DEMO_REFRESH_SECRET = 'nightly-test-secret';
  process.env.URL = 'https://demo.example.test/';
  runRefreshDates.mockReset().mockResolvedValue({
    today: '2026-11-19', demoCompany: { refreshed: true, insertedTotal: 10 }, companies: [{ id: 'c', teams: 2, teamsFilled: 1 }], insertedTotal: 12,
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const post = (token?: string, method = 'POST') =>
  new Request(`https://demo.example.test${DEMO_REFRESH_PATH}`, { method, headers: token ? { [DEMO_REFRESH_HEADER]: token } : {} });

describe('Nightly demo refresh', () => {
  test('NIGHTLY-001 token derives from the secret and falls back to JWT_SECRET', () => {
    const t = demoRefreshToken()!;
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t).not.toContain('nightly-test-secret');
    expect(isValidDemoRefreshToken(t)).toBe(true);
    expect(isValidDemoRefreshToken(t.slice(0, 63) + (t[63] === '0' ? '1' : '0'))).toBe(false);
    expect(isValidDemoRefreshToken('short')).toBe(false);
    expect(isValidDemoRefreshToken(null)).toBe(false);

    delete process.env.DEMO_REFRESH_SECRET;
    expect(demoRefreshToken()).toBeNull();
    expect(isValidDemoRefreshToken(t)).toBe(false);
    process.env.JWT_SECRET = 'jwt-fallback';
    expect(demoRefreshToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(demoRefreshToken()).not.toBe(t);
  });

  test('NIGHTLY-002 worker needs a POST with the right token', async () => {
    await worker(post());
    await worker(post('0'.repeat(64)));
    await worker(post(demoRefreshToken()!, 'GET'));
    expect(runRefreshDates).not.toHaveBeenCalled();

    process.env.DEMO_REFRESH_ENABLED = 'false';
    await worker(post(demoRefreshToken()!));
    expect(runRefreshDates).not.toHaveBeenCalled();

    delete process.env.DEMO_REFRESH_ENABLED;
    await worker(post(demoRefreshToken()!));
    expect(runRefreshDates).toHaveBeenCalledTimes(1);
    expect((console.log as jest.Mock).mock.calls.flat().join(' ')).toContain('12 new rows');

    runRefreshDates.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));
    await expect(worker(post(demoRefreshToken()!))).resolves.toBeUndefined();
  });

  test('NIGHTLY-003 scheduler starts the worker with the token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 202 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await scheduler();
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://demo.example.test${DEMO_REFRESH_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers[DEMO_REFRESH_HEADER]).toBe(demoRefreshToken());
    expect(runRefreshDates).not.toHaveBeenCalled();

    process.env.DEMO_REFRESH_ENABLED = 'false';
    expect(await (await scheduler()).text()).toBe('off');
    delete process.env.DEMO_REFRESH_ENABLED;

    delete process.env.DEMO_REFRESH_SECRET;
    expect((await scheduler()).status).toBe(500);
    process.env.DEMO_REFRESH_SECRET = 'nightly-test-secret';
    delete process.env.URL;
    expect((await scheduler()).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
