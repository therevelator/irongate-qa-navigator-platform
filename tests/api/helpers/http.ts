import request, { Response } from 'supertest';
import { Client } from 'pg';
import dotenv from 'dotenv';

/** Shared helpers for the API suites (live backend at API_URL, local database only). */

dotenv.config();

export const API_URL = process.env.API_URL || 'http://localhost:3000';
export const PW = 'demo123';
export const NEW_PW = 'Passw0rd!';

export function cookieFrom(res: Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const m = cookies.map((c) => c.match(/irongate_token=([^;]+)/)).find(Boolean);
  return m ? `irongate_token=${m[1]}` : '';
}
export async function login(email: string, password = PW) {
  const res = await request(API_URL).post('/api/auth/login').send({ email, password });
  return { cookie: cookieFrom(res), user: res.body.user, status: res.status };
}
export const get = (path: string, cookie = '') => request(API_URL).get(path).set('Cookie', cookie);
export const post = (path: string, cookie = '', body: object = {}) => request(API_URL).post(path).set('Cookie', cookie).send(body);
export const put = (path: string, cookie = '', body: object = {}) => request(API_URL).put(path).set('Cookie', cookie).send(body);
export const patch = (path: string, cookie = '', body: object = {}) => request(API_URL).patch(path).set('Cookie', cookie).send(body);
export const del = (path: string, cookie = '') => request(API_URL).delete(path).set('Cookie', cookie);

export async function backendUp(): Promise<boolean> {
  try {
    const health = await request(API_URL).get('/api/auth/me').timeout(3000);
    return !!health.status;
  } catch {
    return false;
  }
}

/** A client on the LOCAL database (refuses any other host), for setting up states the API cannot (expiry, drift). */
export async function localDb(): Promise<Client> {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  const client = new Client({
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  });
  await client.connect();
  return client;
}
