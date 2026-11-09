import { MAP_ID } from './constants';
import { openAppDb, SAVES_STORE } from './db';
import type { SaveFile, SaveMeta, SerializedSim } from './save';

const STORE = SAVES_STORE;

export interface StoredSave {
  slot: string;
  meta: SaveMeta;
  data: SerializedSim;
}

function openDb(): Promise<IDBDatabase> {
  return openAppDb();
}

/** 每个地图使用独立的存档键，避免同名手动槽位互相覆盖。 */
function storageKey(mapId: string, slot: string): string {
  return `${mapId}::${slot}`;
}

export function saveMapId(meta: SaveMeta): string {
  return meta.mapId ?? MAP_ID;
}

export async function putSave(file: SaveFile): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      slot: storageKey(file.meta.mapId ?? MAP_ID, file.meta.slot),
      meta: file.meta,
      data: file.data,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('写入存档失败'));
  });
  db.close();
}

export async function getSave(slot: string, mapId = MAP_ID): Promise<StoredSave | null> {
  const db = await openDb();
  const key = storageKey(mapId, slot);
  const read = (k: string) =>
    new Promise<StoredSave | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(k);
      req.onsuccess = () => resolve((req.result as StoredSave | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('读取存档失败'));
    });
  let result = await read(key);
  // 兼容 0.9.2 之前的存档：旧键没有地图前缀，归入地形图。
  if (!result && mapId === MAP_ID) result = await read(slot);
  db.close();
  return result;
}

export async function listSaves(mapId?: string): Promise<SaveMeta[]> {
  const db = await openDb();
  const result = await new Promise<SaveMeta[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredSave[] | undefined) ?? [];
      const metas = rows
        .map((r) => r.meta)
        .filter((m) => (mapId ? saveMapId(m) === mapId : true))
        .sort((a, b) => b.savedAt - a.savedAt);
      resolve(metas);
    };
    req.onerror = () => reject(req.error ?? new Error('读取存档列表失败'));
  });
  db.close();
  return result;
}

export async function deleteSave(slot: string, mapId = MAP_ID): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(storageKey(mapId, slot));
    if (mapId === MAP_ID) tx.objectStore(STORE).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('删除存档失败'));
  });
  db.close();
}

export async function latestSave(mapId = MAP_ID): Promise<StoredSave | null> {
  const metas = await listSaves(mapId);
  if (metas.length === 0) return null;
  const newest = metas[0]!;
  return getSave(newest.slot, mapId);
}

export const SLOT_LABELS: Record<string, string> = {
  'manual-1': '手动槽位 1',
  'manual-2': '手动槽位 2',
  'manual-3': '手动槽位 3',
  auto: '自动存档',
};
