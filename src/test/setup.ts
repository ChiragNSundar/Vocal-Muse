import "@testing-library/jest-dom/vitest";

if (!globalThis.crypto) {
  // @ts-expect-error polyfill
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  let i = 0;
  // @ts-expect-error polyfill
  globalThis.crypto.randomUUID = () => `test-uuid-${++i}`;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
