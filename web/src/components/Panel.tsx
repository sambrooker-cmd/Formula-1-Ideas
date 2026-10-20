import type { ReactNode } from 'react';
import { openPanelWindow } from '../layouts';

export function Panel(props: {
  title: string;
  area?: string;
  popout?: string;
  extra?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  const standalone = props.popout && location.pathname === props.popout;
  return (
    <section className="panel" style={props.area ? { gridArea: props.area } : undefined}>
      <header className="panel-head">
        <span className="title">{props.title}</span>
        {props.extra}
        <span className="spacer" />
        {props.popout && !standalone && (
          <button className="icon-btn" title="Open this panel in its own window" onClick={() => openPanelWindow(props.popout!)}>
            ⧉ Pop out
          </button>
        )}
      </header>
      <div className={'panel-body ' + (props.bodyClass ?? '')}>{props.children}</div>
    </section>
  );
}
