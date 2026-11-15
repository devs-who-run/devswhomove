import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import dmSansRegular from './fonts/DMSans-Regular.ttf';
import dmSansSemiBold from './fonts/DMSans-SemiBold.ttf';
import manropeExtraBold from './fonts/Manrope-ExtraBold.ttf';

let ready: Promise<void> | undefined;
let fonts: Uint8Array[] | undefined;

/** Rasterize a share-card SVG to PNG. Workers cannot compile WASM from bytes, so it is imported as a module. */
export async function renderPng(svg: string): Promise<Uint8Array> {
  ready ??= initWasm(resvgWasm).catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
  fonts ??= [manropeExtraBold, dmSansRegular, dmSansSemiBold].map((font) => new Uint8Array(font));
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts, defaultFontFamily: 'DM Sans', sansSerifFamily: 'DM Sans' },
    fitTo: { mode: 'original' },
  });
  try {
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
