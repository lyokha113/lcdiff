import "@testing-library/jest-dom/vitest";

// jsdom lacks ResizeObserver, which Radix primitives (Select, Tooltip) require.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
