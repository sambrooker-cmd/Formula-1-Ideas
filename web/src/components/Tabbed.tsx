import { Suspense, useState, type ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  /** Render the panel for this tab; `lead` is the tab strip to show in its header. */
  render: (lead: ReactNode) => ReactNode;
}

/** A panel slot that can show one of several panels, chosen with tabs (remembered per browser). */
export function Tabbed({ storageKey, tabs }: { storageKey: string; tabs: Tab[] }) {
  const [id, setId] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return tabs.some((t) => t.id === saved) ? saved! : tabs[0].id;
    } catch {
      return tabs[0].id;
    }
  });
  const choose = (next: string) => {
    setId(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // ignore
    }
  };
  const lead = (
    <span className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === id} className={t.id === id ? 'on' : ''} onClick={() => choose(t.id)}>
          {t.label}
        </button>
      ))}
    </span>
  );
  // Some panels load on demand: keep the tabs on screen while one arrives.
  return (
    <Suspense
      fallback={
        <div className="center-msg">
          <div>
            {lead}
            <div style={{ marginTop: 10 }}>Loading…</div>
          </div>
        </div>
      }
    >
      {(tabs.find((t) => t.id === id) ?? tabs[0]).render(lead)}
    </Suspense>
  );
}
