# Frontend ESM Development Rules (GCCD Framework)

To prevent runtime regressions, silent ESM import failures, and undefined handler exceptions, we follow these guidelines:

## Goal
Ensure all frontend scripts compile, import, and execute without runtime errors, while providing immediate, visible feedback on any syntax or initialization failure.

## Context
- The app uses an ESM-compatible client-side HTML layout (`index.html`) loaded via a local HTTP server.
- Stale browser caching of imported ES module dependencies (like `builders.js`, `math.js`) can lead to missing exports, syntax errors, and unresolved references.

## Constraints
1. **No Inline HTML Event Listeners**: All DOM event handlers (e.g., button clicks, tab selections) must be bound programmatically using `addEventListener()` within the `<script type="module">` block, avoiding global `window` object pollution and preventing `ReferenceError`.
2. **Visual Error Boundary**: A global error listener must capture and display all uncaught exceptions, syntax/import errors, and unhandled promise rejections in a prominent UI banner at the top of the viewport.
3. **No Placeholders / Clean Imports**: Every imported JS module must export its components explicitly, and `index.html` must import them correctly without spelling or syntax mismatches.

## Done-when
1. A `<script>` block is placed at the top of `<head>` in `index.html` to register global `'error'` and `'unhandledrejection'` event listeners.
2. A styled `globalErrorBanner` element is added at the top of the body in `index.html`.
3. All inline `onclick` attributes are removed from `index.html` HTML elements.
4. Corresponding event listeners are bound programmatically in `index.html` using `addEventListener()`.
5. The specific ESM import syntax error for `ADAPTER_ABI` is resolved, and the app loads/runs successfully.
6. The test suite (`npm test --prefix tests`) passes successfully.
