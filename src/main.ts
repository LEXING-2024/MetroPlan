import './style.css';
import './ui-v2.css';
import { Application } from 'pixi.js';
import { Game } from './game/game';
import { TERRAIN_MAP } from './maps/terrain';
import { loadMapAssets } from './render/mapAssets';
import { Scene } from './render/scene';
import { VectorBasemap } from './render/vectorBasemap';
import { buildActivityModel } from './sim/activity';

async function boot(): Promise<void> {
  const bootEl = document.getElementById('boot');
  try {
    const assets = await loadMapAssets();
    const canvas = document.getElementById('stage');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('缺少画布元素');

    const app = new Application();
    await app.init({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      background: 0xece7db,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      preference: 'webgl',
      powerPreference: 'high-performance',
      webgl: {
        premultipliedAlpha: false,
      },
    });

    const appEl = document.getElementById('app');
    const basemapEl = document.createElement('div');
    basemapEl.id = 'basemap';
    basemapEl.setAttribute('aria-hidden', 'true');
    if (appEl) appEl.insertBefore(basemapEl, canvas);

    let vectorBasemap: VectorBasemap | null = null;
    try {
      vectorBasemap = new VectorBasemap(basemapEl);
    } catch (err) {
      console.warn('[metro-plan] 矢量底图初始化失败，使用静态底图', err);
    }

    const scene = new Scene(app, assets);
    if (vectorBasemap) scene.attachVectorBasemap(vectorBasemap);
    const game = new Game(scene, app);
    await game.boot();

    const metro = {
      game,
      app,
      scene,
      basemap: vectorBasemap,
      /** M1 demand model is opt-in until the Simulation is migrated in M2. */
      activityModel: (options?: Parameters<typeof buildActivityModel>[1]) =>
        buildActivityModel(TERRAIN_MAP.createField(), options),
    };
    (window as unknown as Record<string, unknown>).__metro = metro;

    bootEl?.classList.add('hidden');
    window.setTimeout(() => bootEl?.remove(), 600);
  } catch (err) {
    console.error('[metro-plan] 启动失败', err);
    if (bootEl) {
      bootEl.innerHTML = `
        <div class="boot-title">无法启动</div>
        <div class="boot-note">${err instanceof Error ? err.message : String(err)}</div>
        <div class="boot-note">请使用支持 WebGL 的现代浏览器，并通过本地服务器打开。</div>
      `;
    }
  }
}

void boot();
