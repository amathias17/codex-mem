import { promises as fs } from "fs";
import path from "path";
import { MemoryIndex, MemoryItem, MEMORY_INDEX_VERSION } from "./schema";
import { readLatestItems } from "./memory-store";

function createEmptyIndex(): MemoryIndex {
  return {
    version: MEMORY_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    byScope: {},
    byTag: {},
    byScopeTag: {},
  };
}

async function ensureIndexFile(indexFile: string): Promise<void> {
  await fs.mkdir(path.dirname(indexFile), { recursive: true });
  try {
    await fs.access(indexFile);
  } catch {
    await fs.writeFile(indexFile, JSON.stringify(createEmptyIndex(), null, 2), "utf8");
  }
}

export async function loadIndex(indexFile: string): Promise<MemoryIndex> {
  await ensureIndexFile(indexFile);
  const raw = await fs.readFile(indexFile, "utf8");
  try {
    const parsed = JSON.parse(raw) as MemoryIndex;
    if (!parsed || parsed.version !== MEMORY_INDEX_VERSION) {
      return createEmptyIndex();
    }
    return parsed;
  } catch {
    return createEmptyIndex();
  }
}

export async function saveIndex(indexFile: string, index: MemoryIndex): Promise<void> {
  await ensureIndexFile(indexFile);
  const updated = { ...index, updatedAt: new Date().toISOString() };
  await fs.writeFile(indexFile, JSON.stringify(updated, null, 2), "utf8");
}

function removeIdFromIndex(index: MemoryIndex, id: string): void {
  for (const scope of Object.keys(index.byScope)) {
    index.byScope[scope] = index.byScope[scope].filter((existing) => existing !== id);
    if (index.byScope[scope].length === 0) delete index.byScope[scope];
  }

  for (const tag of Object.keys(index.byTag)) {
    index.byTag[tag] = index.byTag[tag].filter((existing) => existing !== id);
    if (index.byTag[tag].length === 0) delete index.byTag[tag];
  }

  for (const scope of Object.keys(index.byScopeTag)) {
    for (const tag of Object.keys(index.byScopeTag[scope])) {
      index.byScopeTag[scope][tag] = index.byScopeTag[scope][tag].filter((existing) => existing !== id);
      if (index.byScopeTag[scope][tag].length === 0) delete index.byScopeTag[scope][tag];
    }
    if (Object.keys(index.byScopeTag[scope]).length === 0) delete index.byScopeTag[scope];
  }
}

function addIdToIndex(index: MemoryIndex, item: MemoryItem): void {
  if (!index.byScope[item.scope]) index.byScope[item.scope] = [];
  index.byScope[item.scope].push(item.id);

  for (const tag of item.tags) {
    if (!index.byTag[tag]) index.byTag[tag] = [];
    index.byTag[tag].push(item.id);

    if (!index.byScopeTag[item.scope]) index.byScopeTag[item.scope] = {};
    if (!index.byScopeTag[item.scope][tag]) index.byScopeTag[item.scope][tag] = [];
    index.byScopeTag[item.scope][tag].push(item.id);
  }
}

function sortIndex(index: MemoryIndex, itemsById: Map<string, MemoryItem>): void {
  const sortByUpdated = (ids: string[]) =>
    ids.sort((a, b) => {
      const aItem = itemsById.get(a);
      const bItem = itemsById.get(b);
      const aTime = aItem ? Date.parse(aItem.updatedAt) : 0;
      const bTime = bItem ? Date.parse(bItem.updatedAt) : 0;
      return bTime - aTime;
    });

  for (const scope of Object.keys(index.byScope)) {
    index.byScope[scope] = sortByUpdated(index.byScope[scope]);
  }
  for (const tag of Object.keys(index.byTag)) {
    index.byTag[tag] = sortByUpdated(index.byTag[tag]);
  }
  for (const scope of Object.keys(index.byScopeTag)) {
    for (const tag of Object.keys(index.byScopeTag[scope])) {
      index.byScopeTag[scope][tag] = sortByUpdated(index.byScopeTag[scope][tag]);
    }
  }
}

export function buildIndex(items: MemoryItem[]): MemoryIndex {
  const index = createEmptyIndex();
  const itemsById = new Map<string, MemoryItem>();
  for (const item of items) {
    if (item.deleted) continue;
    itemsById.set(item.id, item);
    addIdToIndex(index, item);
  }
  sortIndex(index, itemsById);
  return index;
}

export async function rebuildIndex(memoryFile: string, indexFile: string): Promise<MemoryIndex> {
  const latest = await readLatestItems(memoryFile);
  const index = buildIndex(latest.items);
  await saveIndex(indexFile, index);
  return index;
}

export async function updateIndexFromItems(indexFile: string, items: MemoryItem[]): Promise<MemoryIndex> {
  const index = await loadIndex(indexFile);
  const itemsById = new Map<string, MemoryItem>();

  for (const item of items) {
    itemsById.set(item.id, item);
    removeIdFromIndex(index, item.id);
    if (!item.deleted) {
      addIdToIndex(index, item);
    }
  }

  sortIndex(index, itemsById);
  await saveIndex(indexFile, index);
  return index;
}
