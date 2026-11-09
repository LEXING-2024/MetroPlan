import { addProtocol } from 'maplibre-gl';

type TileIndex = Record<string, [number, number]>;
type Pack = { buffer: ArrayBuffer; index: TileIndex };

let installed = false;
let packPromise: Promise<Pack> | null = null;

function assetBase(): string {
  return new URL('./', document.baseURI).href;
}

function loadPack(): Promise<Pack> {
  if (!packPromise) {
    const base = assetBase();
    packPromise = Promise.all([
      fetch(`${base}tile-index.json`).then((res) => {
        if (!res.ok) throw new Error(`offline tile index HTTP ${res.status}`);
        return res.json() as Promise<TileIndex>;
      }),
      fetch(`${base}tiles.bin`).then((res) => {
        if (!res.ok) throw new Error(`offline tile pack HTTP ${res.status}`);
        return res.arrayBuffer();
      }),
    ]).then(([index, buffer]) => ({ index, buffer }));
  }
  return packPromise;
}

/**
 * MapLibre custom protocol backed by the prebuilt region pack.
 * URL form: metro://tiles/{z}/{x}/{y}.pbf
 */
export function registerOfflineTilesProtocol(): void {
  if (installed) return;
  installed = true;
  addProtocol('metro', async (params) => {
    const { buffer, index } = await loadPack();
    const match = /tiles\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(params.url);
    if (!match) throw new Error(`invalid offline tile URL: ${params.url}`);
    const key = `${match[1]}/${match[2]}/${match[3]}`;
    const entry = index[key];
    if (!entry) throw new Error(`offline tile not found: ${key}`);
    return { data: buffer.slice(entry[0], entry[0] + entry[1]) };
  });
}

/** Local glyph template, with braces kept literal for MapLibre's replacement. */
export function localGlyphTemplate(): string {
  return `${assetBase()}glyphs/{fontstack}/{range}.pbf`;
}
