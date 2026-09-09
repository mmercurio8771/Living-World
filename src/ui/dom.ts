/** Small DOM helpers. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function button(cls: string, html: string, title = '', onClick?: () => void): HTMLButtonElement {
  const b = el('button', cls, html);
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

export function fmtDays(seconds: number, dayLength: number): string {
  const d = seconds / dayLength;
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}

export const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  film: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M4 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm14 4 4-2v8l-4-2z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 0 1 0 8M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M5 19c0-8 5-13 14-14 1 9-4 14-12 14M5 19c3-4 6-7 10-9"/></svg>',
  help: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="17" r=".9" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4" fill="currentColor"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 3a9 9 0 1 0 7 14.5A8 8 0 0 1 14 3z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/></svg>',
  rain: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 15a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 6a4.5 4.5 0 0 1-.5 9z"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  snow: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 14a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 5a4.5 4.5 0 0 1-.5 9z"/><circle cx="8" cy="19" r="1.2" fill="currentColor"/><circle cx="12" cy="21" r="1.2" fill="currentColor"/><circle cx="16" cy="19" r="1.2" fill="currentColor"/></svg>',
};
