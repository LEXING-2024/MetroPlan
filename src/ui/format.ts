export function yen(n: number): string {
  const v = Math.round(n);
  const sign = v < 0 ? '−' : '';
  return `${sign}¥${Math.abs(v).toLocaleString('zh-CN')}`;
}

export function int(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function minuteText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n)} 分钟`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}