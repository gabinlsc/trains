import { parseSave, serializeSave, type SaveFile } from '@trains/shared';

/**
 * Partie en cours conservée dans le navigateur (IndexedDB). On y range le
 * fichier de sauvegarde sérialisé, exactement comme à l'export : la lecture
 * passe par les mêmes migrations qu'un import.
 */
const DB_NAME = 'rails-de-france';
const DB_VERSION = 1;
const STORE = 'parties';
const CURRENT_KEY = 'courante';

interface StoredGame {
  key: string;
  json: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB'));
    };
  });
}

export class GameStorage {
  private db: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;

  constructor(factory: IDBFactory = indexedDB) {
    this.factory = factory;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        this.db = null;
        reject(req.error ?? new Error('IndexedDB'));
      };
    });
    return this.db;
  }

  async save(game: SaveFile): Promise<void> {
    const db = await this.open();
    const record: StoredGame = { key: CURRENT_KEY, json: serializeSave(game) };
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
  }

  /** Partie en cours, ou null s'il n'y en a pas (ou si elle est illisible). */
  async load(): Promise<SaveFile | null> {
    const db = await this.open();
    const record = (await request(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(CURRENT_KEY),
    )) as StoredGame | undefined;
    if (!record) return null;
    try {
      return parseSave(record.json);
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(CURRENT_KEY));
  }
}

/** Enregistrement différé : une rafale de modifications ne coûte qu'une écriture. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): { (...args: A): void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = (): void => {
    timer = null;
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };
  const debounced = (...args: A): void => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return debounced;
}
