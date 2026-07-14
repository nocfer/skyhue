// @ts-nocheck — this file re-exports from a CDN URL that tsc/checkJs cannot
// resolve without a build; the file itself is only re-export lines, so there is
// nothing here worth type-checking. Consumers see the re-exports as `any`.
// lit-html choke point — the single place the CDN URL and version are pinned.
// Every migrated screen imports { html, render, unsafeHTML } from here, never the
// raw CDN URL, so bumping the version or swapping the CDN is a one-line change.
//
// Why esm.sh and not jsdelivr's `+esm` (which the rest of the app uses for
// Leaflet): jsdelivr inlines a *private copy* of the lit-html core into each
// directive bundle, so `unsafeHTML` would carry a different core instance than
// `render` and the directive would be silently ignored ("multiple versions of
// lit-html loaded"). esm.sh serves every subpath against one shared core module
// (`/lit-html@3.2.1/es2022/lit-html.mjs`), so directives and render agree.
//
// The service worker runtime-caches the esm.sh origin (see sw.js), so these
// modules and their transitive deps work offline after the first load.
export { html, render, nothing } from "https://esm.sh/lit-html@3.2.1";
export { unsafeHTML } from "https://esm.sh/lit-html@3.2.1/directives/unsafe-html.js";
export { repeat } from "https://esm.sh/lit-html@3.2.1/directives/repeat.js";
