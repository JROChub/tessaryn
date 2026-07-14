declare module "@noble/hashes/sha2.js" {
  export interface IncrementalSha256 {
    update(message: Uint8Array): IncrementalSha256;
    digest(): Uint8Array;
    destroy(): void;
    readonly outputLen: number;
    readonly blockLen: number;
  }

  export const sha256: {
    (message: Uint8Array): Uint8Array;
    create(): IncrementalSha256;
    readonly outputLen: number;
    readonly blockLen: number;
  };
}
