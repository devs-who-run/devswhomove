import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const RESVG_WASM = '@resvg/resvg-wasm/index_bg.wasm';

/**
 * Bundle the Worker for Miniflare. Fonts are inlined, and the resvg WASM is supplied as a
 * precompiled module because workerd, like production, cannot compile WASM from bytes.
 */
export async function workerModules() {
  const bundle = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    loader: { '.ttf': 'binary' },
    external: [RESVG_WASM],
  });
  return {
    modules: [
      { type: 'ESModule' as const, path: 'worker.mjs', contents: bundle.outputFiles[0].text },
      {
        type: 'CompiledWasm' as const,
        path: RESVG_WASM,
        contents: new Uint8Array(await readFile(`node_modules/${RESVG_WASM}`)),
      },
    ],
  };
}
