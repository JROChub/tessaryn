declare module "@noble/hashes/sha2.js" {
  export interface IncrementalSha256 {
    update(message: Uint8Array | Uint8ClampedArray | string): IncrementalSha256;
    digest(): Uint8Array;
    destroy(): void;
    readonly outputLen: number;
    readonly blockLen: number;
  }

  export function sha256(
    message: Uint8Array | Uint8ClampedArray | string,
  ): Uint8Array;

  export namespace sha256 {
    function create(): IncrementalSha256;
    const outputLen: number;
    const blockLen: number;
  }
}
