// Minimal ImageData shim for Node.
if (typeof globalThis.ImageData === 'undefined') {
  class NodeImageData {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData;
}
