import { SAVE_DB_NAME, SAVE_DB_VERSION } from './constants';

export const SAVES_STORE = 'saves';
export const MAPS_STORE = 'maps';

/** 游戏存档与创作地图共用同一个 IndexedDB。 */
export function openAppDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(SAVE_DB_NAME, SAVE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVES_STORE)) {
        db.createObjectStore(SAVES_STORE, { keyPath: 'slot' });
      }
      if (!db.objectStoreNames.contains(MAPS_STORE)) {
        db.createObjectStore(MAPS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });
}
