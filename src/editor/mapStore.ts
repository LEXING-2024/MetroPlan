import { openAppDb } from '../sim/db';
import type { CustomMapData } from '../sim/types';

const STORE = 'maps';
const DRAFT_ID = '__draft__';

export interface StoredMap {
  id: string;
  name: string;
  updatedAt: number;
  regions: number;
  pois: number;
  pxPerKm: number | null;
  map: CustomMapData;
}

function row(map: CustomMapData, id = map.id): StoredMap {
  return {
    id,
    name: map.name,
    updatedAt: map.updatedAt,
    regions: map.regions.length,
    pois: map.pois.length,
    pxPerKm: map.pxPerKm,
    map,
  };
}

export async function saveDraft(map: CustomMapData): Promise<void> {
  const db = await openAppDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row(map, DRAFT_ID));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存草稿失败'));
  });
  db.close();
}

export async function loadDraft(): Promise<CustomMapData | null> {
  const db = await openAppDb();
  const result = await new Promise<CustomMapData | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(DRAFT_ID);
    req.onsuccess = () => {
      const stored = req.result as StoredMap | undefined;
      resolve(stored?.map ?? null);
    };
    req.onerror = () => reject(req.error ?? new Error('读取草稿失败'));
  });
  db.close();
  return result;
}

export async function saveMap(map: CustomMapData): Promise<void> {
  const db = await openAppDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row(map));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存地图失败'));
  });
  db.close();
}

export async function getMap(id: string): Promise<StoredMap | null> {
  const db = await openAppDb();
  const result = await new Promise<StoredMap | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredMap | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('读取地图失败'));
  });
  db.close();
  return result;
}

export async function listMaps(): Promise<StoredMap[]> {
  const db = await openAppDb();
  const result = await new Promise<StoredMap[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = ((req.result as StoredMap[] | undefined) ?? []).filter((r) => r.id !== DRAFT_ID);
      resolve(rows.sort((a, b) => b.updatedAt - a.updatedAt));
    };
    req.onerror = () => reject(req.error ?? new Error('读取地图列表失败'));
  });
  db.close();
  return result;
}

export async function deleteMap(id: string): Promise<void> {
  const db = await openAppDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('删除地图失败'));
  });
  db.close();
}
