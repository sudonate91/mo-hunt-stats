/** Inline SVG icons (no icon font). 20px, currentColor. */
const PATHS: Record<string, string> = {
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zm6-1v13m6-10v13',
  board: 'M4 20h16M6 16V9m6 7V4m6 12v-6',
  trends: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  seasons: 'M4 4h16v16H4zM4 10h16M10 4v16',
  h2h: 'M4 6h7v12H4zM13 6h7v12h-7z',
  records: 'M8 21h8m-4-4v4M6 3h12v4a6 6 0 01-12 0V3zM6 5H3v2a3 3 0 003 3m12-5h3v2a3 3 0 01-3 3',
  filter: 'M3 5h18l-7 8v6l-4-2v-4L3 5z',
  county: 'M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11zm0-9a2 2 0 100-4 2 2 0 000 4z',
  about: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-14v.5M12 11v6',
  share: 'M4 12v8h16v-8M12 3v13m-4-9l4-4 4 4',
  close: 'M6 6l12 12M18 6L6 18',
  home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z',
  search: 'M10 17a7 7 0 100-14 7 7 0 000 14zm11 4l-6-6',
  play: 'M6 4l14 8-14 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.about} />
    </svg>
  )
}
