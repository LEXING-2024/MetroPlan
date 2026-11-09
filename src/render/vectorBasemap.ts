import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import labelsRaw from '../../map/data/local-labels.geojson?raw';
import hillshadeUrl from '../../map/assets/hillshade.png?url';
import { buildStyle } from '../../map/src/style.js';
import { TERRAIN_BOUNDS } from '../maps/geo';
import { WORLD_H, WORLD_W } from '../sim/constants';
import { localGlyphTemplate, registerOfflineTilesProtocol } from './offlineTiles';

const localLabels = JSON.parse(labelsRaw) as Record<string, unknown>;

export interface GameView {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * MapLibre basemap adapter for the game.
 *
 * The game remains the single source of truth for the camera. This class only
 * translates the Pixi world transform into a MapLibre center/zoom. It never
 * receives pointer events, so the game's canvas keeps all editing input.
 */
export class VectorBasemap {
  private map: maplibregl.Map;
  private container: HTMLElement;
  private loaded = false;
  private requestedVisible = false;
  private lastKey = '';
  private pendingView: GameView | null = null;
  readonly available = true;

  constructor(container: HTMLElement) {
    this.container = container;
    registerOfflineTilesProtocol();

    const style = buildStyle(localLabels, hillshadeUrl) as StyleSpecification;
    // Use the prebuilt region pack instead of the public tile endpoint.
    style.glyphs = localGlyphTemplate();
    style.sources.osm = {
      type: 'vector',
      tiles: ['metro://tiles/{z}/{x}/{y}.pbf'],
      minzoom: 9,
      maxzoom: 14,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a> · OpenFreeMap / OpenMapTiles',
    };

    this.map = new maplibregl.Map({
      container,
      style,
      center: [112.57, 23.13],
      zoom: 11.8,
      minZoom: 9,
      maxZoom: 18,
      interactive: false,
      attributionControl: false,
      logoPosition: 'bottom-left',
      renderWorldCopies: false,
      fadeDuration: 0,
      localIdeographFontFamily: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
      canvasContextAttributes: {
        antialias: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      },
    });

    this.map.getCanvas().setAttribute('aria-hidden', 'true');
    this.map.getCanvas().setAttribute('tabindex', '-1');
    this.map.getCanvas().style.pointerEvents = 'none';
    this.map.on('load', () => {
      this.loaded = true;
      this.map.resize();
      if (this.pendingView) this.setView(this.pendingView);
      this.applyVisibility();
    });
    this.map.on('error', (event) => {
      const message = event?.error?.message ?? 'unknown MapLibre error';
      // Do not break the game if a tile/font request fails; fall back to paper.
      console.warn('[metro-plan] vector basemap', message);
    });
    this.applyVisibility();
  }

  getMap(): maplibregl.Map {
    return this.map;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  setView(view: GameView): void {
    this.pendingView = view;
    if (!this.loaded || !Number.isFinite(view.scale) || view.scale <= 0) return;

    const { west, east, north, south } = TERRAIN_BOUNDS;
    const centerScreenX = view.width / 2;
    const centerScreenY = view.height / 2;
    const worldX = (centerScreenX - view.offsetX) / view.scale;
    const worldY = (centerScreenY - view.offsetY) / view.scale;

    // Same Web-Mercator projection as src/maps/geo.ts, inverted.
    const lng = west + (worldX / WORLD_W) * (east - west);
    const mercNorth = Math.asinh(Math.tan((north * Math.PI) / 180));
    const mercSouth = Math.asinh(Math.tan((south * Math.PI) / 180));
    const mercY = mercNorth - (worldY / WORLD_H) * (mercNorth - mercSouth);
    const lat = (Math.atan(Math.sinh(mercY)) * 180) / Math.PI;

    // At game scale=1 the 2560 px world must span the same 0.5° longitude
    // window as the static terrain image. MapLibre's 512 px world tile means:
    const zoom = Math.log2((view.scale * WORLD_W * 360) / (512 * (east - west)));

    const key = `${lng.toFixed(6)},${lat.toFixed(6)},${zoom.toFixed(5)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.map.jumpTo({
      center: [lng, lat],
      zoom,
      bearing: 0,
      pitch: 0,
    });
  }

  setVisible(visible: boolean): void {
    this.requestedVisible = visible;
    this.applyVisibility();
  }

  resize(width: number, height: number): void {
    if (!this.loaded) {
      void width;
      void height;
      return;
    }
    this.map.resize();
  }

  destroy(): void {
    this.map.remove();
  }

  private applyVisibility(): void {
    this.container.classList.toggle('is-visible', this.requestedVisible && this.loaded);
    this.container.style.visibility = this.requestedVisible && this.loaded ? 'visible' : 'hidden';
    this.container.style.opacity = this.requestedVisible && this.loaded ? '1' : '0';
  }
}
