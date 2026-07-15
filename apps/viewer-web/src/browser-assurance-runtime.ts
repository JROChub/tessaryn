import type {
  NativeAssuranceBridge,
  NativeWorldCellSeal,
  WorldCellEvidenceRequest,
} from "./world-cell-assurance";

interface AssuranceArtifactRecord {
  name: "tessaryn-browser-assurance-v1.wasm";
  bytes: number;
  sha256: string;
}

export interface BrowserAssuranceManifest {
  schema: "tessaryn.browser-assurance-provenance/v1";
  profile: "eform/world-cell-assurance/v1";
  provider: "tessaryn-browser-assurance::ed25519-dalek/2.2.0";
  power_house_version: "0.3.24";
  entropy_import: "tessaryn.random_fill";
  source_repository: "JROChub/tessaryn";
  source_commit: string;
  artifact: AssuranceArtifactRecord;
}

interface AssuranceExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  tessaryn_assurance_alloc(length: number): number;
  tessaryn_assurance_dealloc(pointer: number, length: number): void;
  tessaryn_assurance_seal(
    cellPointer: number,
    cellLength: number,
    evidencePointer: number,
    evidenceLength: number,
    seedPointer: number,
    seedLength: number,
  ): number;
  tessaryn_assurance_verify(
    cellPointer: number,
    cellLength: number,
    evidencePointer: number,
    evidenceLength: number,
    sealPointer: number,
    sealLength: number,
  ): number;
  tessaryn_assurance_result_pointer(): number;
  tessaryn_assurance_result_length(): number;
  tessaryn_assurance_error_pointer(): number;
  tessaryn_assurance_error_length(): number;
}

interface Allocation {
  pointer: number;
  length: number;
}

const ROOT = "/assurance";
const MANIFEST_URL = `${ROOT}/manifest.json`;
const WASM_URL = `${ROOT}/tessaryn-browser-assurance-v1.wasm`;
const APPROVED_SOURCE_COMMIT = "ecfa0f6584f8890afd4a3a44b4aa972b2768a62e";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEX = /^[0-9a-f]{64}$/;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Assurance artifact unavailable: ${url} (${response.status})`);
  return response.arrayBuffer();
}

function requireManifest(value: unknown): BrowserAssuranceManifest {
  const manifest = value as Partial<BrowserAssuranceManifest>;
  if (manifest.schema !== "tessaryn.browser-assurance-provenance/v1" ||
      manifest.profile !== "eform/world-cell-assurance/v1" ||
      manifest.provider !== "tessaryn-browser-assurance::ed25519-dalek/2.2.0" ||
      manifest.power_house_version !== "0.3.24" ||
      manifest.entropy_import !== "tessaryn.random_fill" ||
      manifest.source_repository !== "JROChub/tessaryn" ||
      manifest.source_commit !== APPROVED_SOURCE_COMMIT) {
    throw new Error("Browser assurance manifest violates the approved trust contract");
  }
  const artifact = manifest.artifact;
  if (!artifact || artifact.name !== "tessaryn-browser-assurance-v1.wasm" ||
      !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 ||
      !HEX.test(artifact.sha256)) {
    throw new Error("Browser assurance artifact record is invalid");
  }
  return manifest as BrowserAssuranceManifest;
}

function requireModuleContract(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 1 || imports[0]?.module !== "tessaryn" ||
      imports[0]?.name !== "random_fill" || imports[0]?.kind !== "function") {
    throw new Error(`Browser assurance imports are not approved: ${JSON.stringify(imports)}`);
  }
  const exports = new Set(WebAssembly.Module.exports(module).map((item) => item.name));
  for (const name of [
    "memory",
    "tessaryn_assurance_alloc",
    "tessaryn_assurance_dealloc",
    "tessaryn_assurance_seal",
    "tessaryn_assurance_verify",
    "tessaryn_assurance_result_pointer",
    "tessaryn_assurance_result_length",
    "tessaryn_assurance_error_pointer",
    "tessaryn_assurance_error_length",
  ]) {
    if (!exports.has(name)) throw new Error(`Browser assurance export is missing: ${name}`);
  }
}

class BrowserAssuranceRuntime implements NativeAssuranceBridge {
  private readonly seed = crypto.getRandomValues(new Uint8Array(32));

  private constructor(private readonly wasm: AssuranceExports) {}

  static async load(): Promise<{
    bridge: BrowserAssuranceRuntime;
    manifest: BrowserAssuranceManifest;
  }> {
    if (!globalThis.isSecureContext || typeof WebAssembly !== "object" ||
        !crypto?.subtle || typeof crypto.getRandomValues !== "function") {
      throw new Error("Browser assurance requires a secure WebAssembly and Web Crypto context");
    }
    const response = await fetch(MANIFEST_URL, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Browser assurance manifest unavailable (${response.status})`);
    const manifest = requireManifest(await response.json());
    const bytes = await fetchBytes(WASM_URL);
    if (bytes.byteLength !== manifest.artifact.bytes ||
        await sha256(bytes) !== manifest.artifact.sha256) {
      throw new Error("Browser assurance artifact does not match its provenance manifest");
    }

    const module = await WebAssembly.compile(bytes);
    requireModuleContract(module);
    let memory: WebAssembly.Memory | null = null;
    const instance = await WebAssembly.instantiate(module, {
      tessaryn: {
        random_fill(pointer: number, length: number): number {
          try {
            if (!memory || pointer < 0 || length < 0 ||
                pointer + length > memory.buffer.byteLength) return -1;
            const output = new Uint8Array(memory.buffer, pointer, length);
            for (let offset = 0; offset < output.length; offset += 65_536) {
              crypto.getRandomValues(output.subarray(offset, Math.min(output.length, offset + 65_536)));
            }
            return 0;
          } catch {
            return -1;
          }
        },
      },
    });
    const wasm = instance.exports as AssuranceExports;
    memory = wasm.memory;
    return { bridge: new BrowserAssuranceRuntime(wasm), manifest };
  }

  async sealWorldCell(input: {
    canonicalCell: string;
    evidence: WorldCellEvidenceRequest;
  }): Promise<NativeWorldCellSeal> {
    const cell = encoder.encode(input.canonicalCell);
    const evidence = encoder.encode(JSON.stringify(input.evidence));
    const allocations = [
      this.allocate(cell),
      this.allocate(evidence),
      this.allocate(this.seed),
    ] as const;
    try {
      const status = this.wasm.tessaryn_assurance_seal(
        allocations[0].pointer, allocations[0].length,
        allocations[1].pointer, allocations[1].length,
        allocations[2].pointer, allocations[2].length,
      );
      if (status !== 0) throw new Error(this.errorMessage("Browser assurance seal failed"));
      return JSON.parse(this.resultText()) as NativeWorldCellSeal;
    } finally {
      this.zero(allocationView(this.wasm.memory, allocations[2]));
      allocations.forEach((allocation) => this.free(allocation));
    }
  }

  async verifyWorldCell(input: {
    canonicalCell: string;
    evidence: WorldCellEvidenceRequest;
    seal: NativeWorldCellSeal;
  }): Promise<boolean> {
    const values = [
      encoder.encode(input.canonicalCell),
      encoder.encode(JSON.stringify(input.evidence)),
      encoder.encode(JSON.stringify(input.seal)),
    ];
    const allocations = values.map((value) => this.allocate(value));
    try {
      return this.wasm.tessaryn_assurance_verify(
        allocations[0]!.pointer, allocations[0]!.length,
        allocations[1]!.pointer, allocations[1]!.length,
        allocations[2]!.pointer, allocations[2]!.length,
      ) === 1;
    } finally {
      allocations.forEach((allocation) => this.free(allocation));
    }
  }

  private allocate(value: Uint8Array): Allocation {
    if (value.byteLength === 0) throw new Error("Browser assurance refuses empty input");
    const pointer = this.wasm.tessaryn_assurance_alloc(value.byteLength);
    if (!pointer) throw new Error("Browser assurance allocation failed");
    allocationView(this.wasm.memory, { pointer, length: value.byteLength }).set(value);
    return { pointer, length: value.byteLength };
  }

  private free(allocation: Allocation): void {
    this.wasm.tessaryn_assurance_dealloc(allocation.pointer, allocation.length);
  }

  private zero(value: Uint8Array): void {
    value.fill(0);
  }

  private resultText(): string {
    const pointer = this.wasm.tessaryn_assurance_result_pointer();
    const length = this.wasm.tessaryn_assurance_result_length();
    if (!pointer || !length) throw new Error("Browser assurance returned an empty seal");
    return decoder.decode(new Uint8Array(this.wasm.memory.buffer, pointer, length).slice());
  }

  private errorMessage(fallback: string): string {
    const pointer = this.wasm.tessaryn_assurance_error_pointer();
    const length = this.wasm.tessaryn_assurance_error_length();
    if (!pointer || !length) return fallback;
    return decoder.decode(new Uint8Array(this.wasm.memory.buffer, pointer, length).slice());
  }
}

function allocationView(memory: WebAssembly.Memory, allocation: Allocation): Uint8Array {
  return new Uint8Array(memory.buffer, allocation.pointer, allocation.length);
}

export async function installBrowserAssuranceBridge(): Promise<BrowserAssuranceManifest> {
  const { bridge, manifest } = await BrowserAssuranceRuntime.load();
  window.tessarynAssurance = bridge;
  return manifest;
}
