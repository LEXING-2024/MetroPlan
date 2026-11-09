import './style.css';
import { Application } from 'pixi.js';
import { Game } from './game/game';
import { loadMapAssets } from './render/mapAssets';
import { Scene } from './render/scene';

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
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });

    const scene = new Scene(app, assets);
    const game = new Game(scene, app);
    await game.boot();

    (window as unknown as Record<string, unknown>).__metro = { game, app, scene };

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
