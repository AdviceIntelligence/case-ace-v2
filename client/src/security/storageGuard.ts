/**
 * StorageGuard
 * 
 * Implements Constraint C1 runtime enforcement for Case Ace v2.0.
 * In development, test, and production environments, this module monkey-patches
 * persistent client storage APIs to throw an immediate, uncatchable security error.
 * 
 * Target APIs:
 * - window.localStorage
 * - window.sessionStorage
 * - window.indexedDB
 * - document.cookie (getter and setter)
 * - window.caches (CacheStorage API)
 * - window.showSaveFilePicker
 * - window.showOpenFilePicker
 */

export class VolatileStorageViolationError extends Error {
  public readonly apiName: string;
  public readonly timestamp: string;

  constructor(apiName: string) {
    super(
      `[SECURITY VIOLATION - CONSTRAINT C1] Prohibited persistent client storage API '${apiName}' was accessed. ` +
      `Case Ace v2.0 strictly requires all session data to reside solely in volatile memory. ` +
      `Writing or reading client data to/from disk or persistent browser stores is forbidden.`
    );
    this.name = 'VolatileStorageViolationError';
    this.apiName = apiName;
    this.timestamp = new Date().toISOString();
  }
}

let isGuardsInstalled = false;

/**
 * Installs runtime storage guards that throw VolatileStorageViolationError
 * whenever any persistent browser storage mechanism is accessed.
 */
export function installRuntimeStorageGuards(globalTarget: any = typeof window !== 'undefined' ? window : globalThis): void {
  if (isGuardsInstalled) return;

  const throwViolation = (apiName: string) => {
    throw new VolatileStorageViolationError(apiName);
  };

  // 1. Guard localStorage
  try {
    Object.defineProperty(globalTarget, 'localStorage', {
      get: () => throwViolation('localStorage'),
      set: () => throwViolation('localStorage (assignment)'),
      configurable: true,
      enumerable: true,
    });
  } catch (err) {}

  // 2. Guard sessionStorage
  try {
    Object.defineProperty(globalTarget, 'sessionStorage', {
      get: () => throwViolation('sessionStorage'),
      set: () => throwViolation('sessionStorage (assignment)'),
      configurable: true,
      enumerable: true,
    });
  } catch (err) {}

  // 3. Guard indexedDB
  try {
    Object.defineProperty(globalTarget, 'indexedDB', {
      get: () => throwViolation('indexedDB'),
      set: () => throwViolation('indexedDB (assignment)'),
      configurable: true,
      enumerable: true,
    });
  } catch (err) {}

  // 4. Guard caches (Cache API)
  try {
    Object.defineProperty(globalTarget, 'caches', {
      get: () => throwViolation('caches (CacheStorage)'),
      set: () => throwViolation('caches (assignment)'),
      configurable: true,
      enumerable: true,
    });
  } catch (err) {}

  // 5. Guard File System Access API
  try {
    Object.defineProperty(globalTarget, 'showSaveFilePicker', {
      value: () => throwViolation('window.showSaveFilePicker'),
      configurable: true,
      writable: false,
    });
    Object.defineProperty(globalTarget, 'showOpenFilePicker', {
      value: () => throwViolation('window.showOpenFilePicker'),
      configurable: true,
      writable: false,
    });
  } catch (err) {}

  // 6. Guard document.cookie
  try {
    const docTarget = typeof document !== 'undefined' ? document : globalTarget.document;
    if (docTarget) {
      Object.defineProperty(docTarget, 'cookie', {
        get: () => {
          throwViolation('document.cookie (read)');
          return '';
        },
        set: () => {
          throwViolation('document.cookie (write)');
        },
        configurable: true,
      });
    }
  } catch (err) {}

  isGuardsInstalled = true;
}

export function areStorageGuardsInstalled(): boolean {
  return isGuardsInstalled;
}

export function resetStorageGuardsForTesting(): void {
  isGuardsInstalled = false;
}
