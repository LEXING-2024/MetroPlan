import type { MapSummary } from '../maps/types';
import { escapeHtml } from './format';

/** 通勤者数量按中文习惯显示：1.2 万 / 8,400。 */
function commuterLabel(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return Math.round(n).toLocaleString('zh-CN');
}

/** 地图选择卡片：独立成模块，避免主 UI 文件继续膨胀。 */
export function renderMapCards(maps: MapSummary[], selectedId: string): string {
  return maps
    .map(
      (m) => `
      <button class="mode-card map-card${m.id === selectedId ? ' selected' : ''}" data-map-id="${m.id}">
        <span class="mode-tag">${m.style === 'plain' ? '纯色' : '地形'}</span>
        <b>${escapeHtml(m.name)}</b>
        <p>${escapeHtml(m.description)}</p>
        <small>${escapeHtml(m.subtitle)} · 约 ${commuterLabel(m.agents)} 出行个体 · 独立存档</small>
      </button>`,
    )
    .join('');
}
