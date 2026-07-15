declare module "@noble/hashes/sha2.js" {
  export function sha256(message: Uint8ClampedArray): Uint8Array;
  export function sha256(message: Uint8Array): Uint8Array;
  export function sha256(message: string): Uint8Array;
}
