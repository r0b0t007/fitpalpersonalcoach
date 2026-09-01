// Runs before every test file (see `test.setupFiles` in vite.config.js).
//
// Recent Node exposes its own `localStorage` global that reads as `undefined` unless the process
// was started with --localstorage-file. Vitest's happy-dom environment builds the test globals from
// Node's globalThis, so that `undefined` lands on the window and clobbers the working implementation
// happy-dom itself provides — constructing a happy-dom Window directly on the same runtime gives a
// normal localStorage object, which is what rules happy-dom out as the culprit. `sessionStorage` is
// untouched, which is why only the suites reaching for localStorage were affected.
//
// No version threshold is quoted here on purpose: Node 22 does not expose it (CI ran green on 22
// for a long time calling bare `localStorage.clear()`), Node 26 does, and pinning down the exact
// release that flipped is less useful than the feature check below, which is correct on all of them.
//
// Worth knowing that this is not cosmetic. useStore.js wraps its storage reads in try/catch, so on
// an affected runtime every one of them threw and was silently swallowed — the whole suite ran
// against a degraded no-storage path while CI ran against a working one. Restoring localStorage
// brings local back in line with CI rather than papering over one assertion.
//
// Scope is deliberately the Storage method API and nothing more: no `Storage` prototype (so
// `instanceof Storage` is false), no property-style access (`localStorage.foo = 1`), no `storage`
// events. The app only ever calls getItem/setItem/removeItem/clear, so that is the whole contract
// worth honouring — widen it if that stops being true, rather than assuming it is a full polyfill.
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
