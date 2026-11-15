declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module '*.ttf' {
  const data: ArrayBuffer | Uint8Array;
  export default data;
}
