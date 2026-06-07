import "@testing-library/jest-dom/vitest";

// Node v25+ ships an experimental global `localStorage` that lacks `.clear()`.
// vitest exposes the underlying jsdom instance as `global.jsdom`; use its
// window to get the fully-functional Storage implementation.
const _jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window;
if (_jsdomWindow && typeof globalThis.localStorage?.clear !== "function") {
  Object.defineProperty(globalThis, "localStorage", {
    value: _jsdomWindow.localStorage,
    writable: true,
    configurable: true,
  });
}
