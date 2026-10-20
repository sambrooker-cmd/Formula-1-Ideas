// npm run ingest -- --year 2025 --race "Abu Dhabi" --session Race
// npm run ingest -- --session-key 9839
import { parseArgs } from 'node:util';
import { ingestSession, resolveSession } from './ingest.ts';
import { requestsMade } from './openf1.ts';

const { values } = parseArgs({
  options: {
    year: { type: 'string' },
    race: { type: 'string' },
    session: { type: 'string', default: 'Race' },
    'session-key': { type: 'string' },
  },
});

const started = Date.now();
try {
  const session = await resolveSession({
    sessionKey: values['session-key'] ? Number(values['session-key']) : undefined,
    year: values.year ? Number(values.year) : undefined,
    race: values.race,
    session: values.session,
  });
  console.log(`Ingesting ${session.year} ${session.country_name} (${session.location}) – ${session.session_name}, session_key ${session.session_key}`);
  let lastLine = '';
  await ingestSession(session.session_key, (p) => {
    if (p.message === 'downloading') return;
    const pct = Math.round((p.done / Math.max(1, p.total)) * 100);
    const line = `[${String(pct).padStart(3)}%] ${p.done}/${p.total} ${p.step}${p.message ? ' – ' + p.message : ''}`;
    if (line !== lastLine) console.log(line);
    lastLine = line;
  });
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`Done in ${Math.floor(secs / 60)}m ${secs % 60}s with ${requestsMade()} API requests.`);
} catch (err) {
  console.error('\nIngest failed:', (err as Error).message);
  console.error('Re-run the same command to resume; finished steps are not downloaded again.');
  process.exit(1);
}
