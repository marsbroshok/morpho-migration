# Frontend ESM Development Rules (GCCD Framework)

To prevent runtime regressions, silent ESM import failures, and undefined handler exceptions, we follow these guidelines:

## Goal
Ensure all frontend scripts compile, import, and execute without runtime errors, while providing immediate, visible feedback on any syntax or initialization failure.

## Context
- The app uses an ESM-compatible client-side HTML layout (`index.html`) loaded via a local HTTP server.
- Stale browser caching of imported ES module dependencies (like `builders.js`, `math.js`) can lead to missing exports, syntax errors, and unresolved references.

## Constraints
1. **Architectural Separation**: All JavaScript logic must reside in `app.js`. No inline scripts are allowed in `index.html` except for the global error boundary hook.
2. **No Inline HTML Event Listeners**: All DOM event handlers (e.g., button clicks, tab selections, input fields) must be bound programmatically using `addEventListener()` inside the `app.js` module.
3. **Visual Error Boundary**: A global error listener must capture and display all uncaught exceptions, syntax/import errors, and unhandled promise rejections in a prominent UI banner at the top of the viewport in `index.html`.
4. **Automated Sanity Testing**: A JSDOM-based integration test (`tests/app.test.mjs`) must verify script loading, relative import path resolution, DOM queries, and event listener attachments without requiring a real browser.

## Done-when
1. A `<script>` block is placed at the top of `<head>` in `index.html` to register global `'error'` and `'unhandledrejection'` event listeners.
2. A styled `globalErrorBanner` element is added at the top of the body in `index.html`.
3. JavaScript is completely separated into `app.js`, and `index.html` references it as `<script type="module" src="./app.js"></script>`.
4. All event listeners are programmatically bound inside `app.js`.
5. The `npm test --prefix tests` suite runs successfully, including the JSDOM integration test (`node app.test.mjs`).
