// Runs before every test file (see `test.setupFiles` in vite.config.js).
//
// Node >=22.4 ships its own experimental `localStorage` global that is `undefined` unless the
// process is started with --localstorage-file. Vitest's happy-dom environment builds the test
// globals from Node's globalThis, so that `undefined` lands on the window and clobbers the working
// implementation happy-dom itself provides — verified by constructing a happy-dom Window directly,
// where localStorage is a normal object on the same runtime. `sessionStorage` is untouched, which
// is why only the one suite that reaches for localStorage breaks.
//
// CI pins Node 22 and is unaffected, so the symptom is a suite that fails locally on a newer
// runtime and passes in CI — the worst shape for a test suite, because it teaches people to stop
// reading it. This restores a spec-shaped Storage only when the environment failed to supply one,
// so it is a no-op on Node 22 and in any future runtime that fixes this.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map()
  const storage = {
    get length() { return store.size },
    key: i => Array.from(store.keys())[i] ?? null,
    getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)) },
    removeItem: k => { store.delete(String(k)) },
    clear: () => { store.clear() }
  }
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'localStorage', { value: storage, configurable: true, writable: true })
  }
}
