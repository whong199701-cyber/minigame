/**
 * Spec §11.8 entry point: the lazily loaded renderer chunk. The implementation lives in ./render/ (the only code that
 * imports `three`); the UI loads it with `import('./renderer')` so three.js stays out of the game's first chunk.
 */
export { default, createRenderer, Renderer, renderStrings } from './render';
