// Home page card (hosted site): turn notifications on for this device and choose which ones.
import { useEffect, useState } from 'react';
import { currentSubscription, disablePush, enablePush, isAppleMobile, isStandalone, localTest, pushSupported, savedPrefs, type PushPrefs } from '../push';

export function NotificationsCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(savedPrefs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    currentSubscription().then((s) => setOn(!!s), () => setOn(false));
  }, []);

  const run = async (f: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      if (done) setMsg(done);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = (p: Partial<PushPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    if (on) void run(() => enablePush(next), 'Saved.');
  };

  let body;
  if (!pushSupported()) {
    body =
      isAppleMobile() && !isStandalone() ? (
        <p className="muted" style={{ margin: 0 }}>
          On iPad and iPhone, notifications come through the home-screen app: tap <b className="text">Share → Add to Home Screen</b>, open Pit Wall from the new
          icon, sign in, and turn them on here.
        </p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>This browser can't receive notifications.</p>
      );
  } else {
    body = (
      <>
        <div className="notify-options">
          <label>
            Reminders before{' '}
            <select value={prefs.reminders} onChange={(e) => change({ reminders: e.target.value as PushPrefs['reminders'] })}>
              <option value="main">qualifying, sprints and races</option>
              <option value="all">every session, practice too</option>
              <option value="off">nothing (no reminders)</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={prefs.incidents} onChange={(e) => change({ incidents: e.target.checked })} /> Safety Car, VSC and red flags as they
            happen
          </label>
          <label>
            <input type="checkbox" checked={prefs.results} onChange={(e) => change({ results: e.target.checked })} /> Results: the podium, and who's on pole
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {!on ? (
            <button className="btn primary" disabled={busy || on === null} onClick={() => run(async () => (await enablePush(prefs), setOn(true)), 'Notifications are on for this device.')}>
              Turn on for this device
            </button>
          ) : (
            <>
              <button className="btn" disabled={busy} onClick={() => run(localTest)}>
                Show a test
              </button>
              <button className="btn" disabled={busy} onClick={() => run(async () => (await disablePush(), setOn(false)), 'Turned off for this device.')}>
                Turn off
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Notifications</h2>
        {on && <span className="battle-tag">on for this device</span>}
      </div>
      <p className="muted" style={{ margin: '6px 0 10px' }}>Arrive even when the Pit Wall is closed. Each device chooses its own.</p>
      {body}
      {msg && (
        <p className="muted" style={{ margin: '8px 0 0' }}>
          {msg}
        </p>
      )}
    </section>
  );
}
