/**
 * Inline SVG icons for header buttons. Unicode arrows such as ↻ and ↶ are missing or render as boxes in some
 * CJK system fonts, so the shell swaps well-known glyphs for these drawings. Unknown icons fall back to text.
 */
const wrap = (inner: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const restart = wrap('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8.5"/><path d="M20.5 3.5v5h-5"/>');
const undo = wrap('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');

export const ICONS: Record<string, string> = {
  '↻': restart,
  '⟳': restart,
  '↶': undo,
  '↺': undo,
  '⏸': wrap('<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>', true),
  '▶': wrap('<path d="M7 4.5v15l12.5-7.5z"/>', true),
  '☰': wrap('<path d="M4 6.5h16M4 12h16M4 17.5h16"/>'),
  '▤': wrap('<path d="M9 6.5h11M9 12h11M9 17.5h11M4 6.5h.01M4 12h.01M4 17.5h.01"/>'),
  back: wrap('<path d="m15 18-6-6 6-6"/>'),
};

/** Fill a button with the SVG for `icon` when one exists, otherwise with the text itself. */
export function setIcon(target: HTMLElement, icon: string): void {
  const svg = ICONS[icon];
  if (svg) target.innerHTML = svg;
  else target.textContent = icon;
}
