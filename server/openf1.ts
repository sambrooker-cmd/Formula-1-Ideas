// The one and only way this app talks to OpenF1. Every request goes through a
// single queue spaced MIN_GAP_MS apart, so we stay under the free tier's
// 30 requests/minute (and 3/second) no matter who is calling.

import { credentials } from './env.ts';

const BASE = 'https://api.openf1.org/v1/';
// Free tier: 30 req/min, so 24/min. Sponsor tier: 60 req/min, so 50/min.
const MIN_GAP_MS = credentials ? 1200 : 2500;
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 80_000];

export class TooMuchDataError extends Error {}
export class OpenF1Error extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let token: { value: string; expires: number } | null = null;

/** OAuth2 token for the sponsor tier (valid 1 hour; refreshed 5 minutes early). Null without credentials. */
export async function accessToken(): Promise<string | null> {
  if (!credentials) return null;
  if (token && Date.now() < token.expires - 5 * 60_000) return token.value;
  const res = await fetch('https://api.openf1.org/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(credentials),
  });
  if (!res.ok) throw new OpenF1Error(`OpenF1 login failed (${res.status}): check OPENF1_USERNAME / OPENF1_PASSWORD in .env`, res.status);
  const body = (await res.json()) as { access_token: string; expires_in: string | number };
  token = { value: body.access_token, expires: Date.now() + Number(body.expires_in) * 1000 };
  return token.value;
}

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let requestCount = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function requestsMade() {
  return requestCount;
}

/**
 * GET an OpenF1 endpoint. `query` is a raw query string so comparison filters
 * like `date>=...` can be passed as-is, e.g. get('laps', 'session_key=9839').
 * Returns [] when OpenF1 says "No results found".
 */
export function get<T = Record<string, any>>(endpoint: string, query = ''): Promise<T[]> {
  const run = async () => {
    const url = BASE + endpoint + (query ? '?' + query : '');
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      requestCount++;

      let res: Response;
      try {
        const bearer = await accessToken();
        res = await fetch(url, {
          headers: {
            'accept-encoding': 'gzip',
            'user-agent': 'pit-wall-fan-project',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
        });
      } catch (err) {
        if (attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        throw new OpenF1Error(`Network error for ${url}: ${(err as Error).message}`, 0);
      }

      if (res.ok) return (await res.json()) as T[];
      const body = await res.text();
      if (res.status === 404 && body.includes('No results')) return [];
      if (res.status === 422) throw new TooMuchDataError(body);
      if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      if ((res.status === 401 || res.status === 403) && credentials && attempt === 0) {
        token = null; // expired early; log in again once
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new OpenF1Error(
          `OpenF1 refused access (${res.status}). The free tier is unavailable while a session is live ` +
            `(roughly 30 min before to 30 min after) — try again later. ${body}`,
          res.status,
        );
      }
      throw new OpenF1Error(`OpenF1 ${res.status} for ${url}: ${body.slice(0, 300)}`, res.status);
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
