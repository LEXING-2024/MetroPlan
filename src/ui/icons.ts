const PATHS: Record<string, string> = {
  coin: '<circle cx="12" cy="12" r="8.4"/><path d="M8.8 7.6 12 11.8l3.2-4.2M12 11.8V17M9.2 13.9h5.6M9.2 16h5.6"/>',
  people:
    '<circle cx="9.2" cy="8.2" r="3"/><path d="M3.6 19.2c.7-3.1 2.9-4.8 5.6-4.8s4.9 1.7 5.6 4.8"/><circle cx="16.8" cy="8.8" r="2.2"/><path d="M15.2 14.6c2.5 0 4.4 1.5 5 4.2"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3.4v2M12 18.6v2M20.6 12h-2M5.4 12h-2M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4M18.1 18.1l-1.4-1.4M7.3 7.3 5.9 5.9"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 1.9"/>',
  check: '<circle cx="12" cy="12" r="8.4"/><path d="M8.2 12.2l2.6 2.6 5-5.6"/>',
  question:
    '<circle cx="12" cy="12" r="8.4"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.5 2.4c-.8.3-1 .9-1 1.6v.3"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/>',
  save: '<path d="M5 4.5h11l3 3v12H5z"/><path d="M8.2 4.5v5.4h6.8V4.5M8.2 19.5v-5.6h7.6v5.6"/>',
  settings:
    '<path d="M4 7.4h8.4M17.2 7.4H20M4 16.6h2.8M11.6 16.6H20"/><circle cx="15" cy="7.4" r="2"/><circle cx="9.2" cy="16.6" r="2"/>',
  pause: '<path d="M9.2 6v12M14.8 6v12"/>',
  play: '<path d="M8.4 5.4 18 12 8.4 18.6z" fill="currentColor" stroke="none"/>',
  station: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  line: '<path d="M5 17.2 10.4 7.6l3.8 6.2L19 5.6"/><circle cx="5" cy="17.2" r="2"/><circle cx="14.2" cy="13.8" r="2"/><circle cx="19" cy="5.6" r="2"/>',
  train:
    '<rect x="6.2" y="4.2" width="11.6" height="12.8" rx="3"/><path d="M6.2 10h11.6M9 20.4l1.8-3.4M15 20.4l-1.8-3.4"/><circle cx="9.6" cy="13.6" r=".8" fill="currentColor" stroke="none"/><circle cx="14.4" cy="13.6" r=".8" fill="currentColor" stroke="none"/>',
  undo: '<path d="M5 9.4h8.2a4 4 0 0 1 0 8H8.4"/><path d="M8.2 5.6 4.4 9.4l3.8 3.8"/>',
  swap: '<path d="M4 8h13l-3.2-3.2M20 16H7l3.2 3.2"/>',
  close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
  reset: '<path d="M4.6 12a7.4 7.4 0 1 0 2.2-5.3"/><path d="M4.4 4.4v4.4H8.8"/>',
  ticket: '<path d="M4 8h16v2.6a1.6 1.6 0 0 0 0 3.2V17H4v-3.2a1.6 1.6 0 0 0 0-3.2z"/><path d="M9.4 8v2M9.4 13.8V17"/>',
  trend: '<path d="M4 17.4 9.4 12l3.4 3.4L20 7.4"/><path d="M15.2 7.4H20v4.8"/>',
  tag: '<path d="M4 4h6.8L20 13.2 13.2 20 4 10.8z"/><circle cx="8.4" cy="8.4" r="1.3"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  download: '<path d="M12 4.4v10M8.2 10.6 12 14.4l3.8-3.8M5 19.4h14"/>',
  upload: '<path d="M12 15.6v-10M8.2 9.4 12 5.6l3.8 3.8M5 19.4h14"/>',
  trash: '<path d="M5 7h14M9.4 7V4.8h5.2V7M7.2 7l.9 12.2h7.8L16.8 7"/>',
  plus: '<path d="M12 6.2v11.6M6.2 12h11.6"/>',
  minus: '<path d="M6.2 12h11.6"/>',
  cursor: '<path d="M6 4.2 18 11l-5.6 1.6L10 18z"/>',
  warning: '<path d="M12 4.4 21 20H3z"/><path d="M12 9.2v4.6"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/>',
  map: '<path d="M9 4.6 3.8 6.8v12.6L9 17.2l6 2.2 5.2-2.2V4.6L15 6.8z"/><path d="M9 4.6v12.6M15 6.8v12.6"/>',
  arrow: '<path d="M5 12h13M13.4 6.8 18.6 12l-5.2 5.2"/>',
  back: '<path d="M19 12H5M10.4 6.8 5.2 12l5.2 5.2"/>',
  grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4.6-5.2"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  home: '<path d="M4.6 10.6 12 4.4l7.4 6.2V20H4.6z"/><path d="M9.6 20v-5.2h4.8V20"/>',
  briefcase:
    '<rect x="3.8" y="7.4" width="16.4" height="11.4" rx="2"/><path d="M9 7.4V5.6h6v1.8M3.8 12.2h16.4"/>',
  brush: '<path d="M7 17c-2 0-3.2 1.2-4 3 3.2.8 5-.4 6-2M8.2 15.8l7.6-7.6 4 4-7.6 7.6z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.2 11V8.2a3.8 3.8 0 0 1 7.6 0V11"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.2 11V8.2a3.8 3.8 0 0 1 7.2-1.6"/>',
  hospital: '<path d="M12 6.5v11M6.5 12h11"/>',
  mountain: '<path d="M3 19.5 9 7l3.5 6.5L15 9l6 10.5z"/>',
  boat: '<path d="M4.5 15.5h15l-2.8 4H7.3zM12 15.5V5.5l5 4"/>',
  book: '<path d="M4 5h6.5a2 2 0 0 1 1.5.7V19a2.4 2.4 0 0 0-1.8-.8H4zM20 5h-6.5a2 2 0 0 0-1.5.7V19a2.4 2.4 0 0 1 1.8-.8H20z"/>',
  bag: '<path d="M5 8h14l-1.2 11.5H6.2zM9 8V6.2a3 3 0 0 1 6 0V8"/>',
  tree: '<path d="M12 3.5 17 11h-2.6l3.6 5H6l3.6-5H7zM12 16v4.5"/>',
  stadium: '<ellipse cx="12" cy="12" rx="9" ry="5"/><path d="M7.5 12h9"/>',
  plane: '<path d="M12 3.5 13.7 10l6.8 2.8v2L13.7 14l-1 4.8 2.3 1.6v1.1L12 20.6l-3 1v-1.1l2.3-1.6-1-4.8-6.8.8v-2L10.3 10z"/>',
  factory: '<path d="M3 20V9l6 4V9l6 4V5h5v15z"/>',
};
export function icon(name: string, size = 18): string {
  const path = PATHS[name] ?? PATHS.dot ?? '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
