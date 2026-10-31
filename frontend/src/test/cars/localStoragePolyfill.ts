// Newer Node builds expose an experimental, non-functional `localStorage`
// global that shadows jsdom's. Install a plain in-memory Storage so the
// browser-held profile code (spec 022 R2) can be exercised in tests.

function makeStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store = new Map();
    },
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
}

const existing = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

if (!existing || typeof existing.clear !== "function") {
  const storage = makeStorage();
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}
