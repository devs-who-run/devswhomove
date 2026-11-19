declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module '*.ttf' {
  const data: ArrayBuffer | Uint8Array;
  export default data;
}

declare module '*.svg?raw' {
  const svg: string;
  export default svg;
}
