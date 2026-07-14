interface GPUAdapterInfo { description?: string; device?: string }
interface GPUAdapter { info?: GPUAdapterInfo; requestDevice(): Promise<GPUDevice> }
interface GPU { requestAdapter(options?: unknown): Promise<GPUAdapter | null> }
interface GPUDevice {
  createShaderModule(options: unknown): any;
  createBuffer(options: unknown): any;
  createComputePipeline(options: unknown): any;
  createBindGroup(options: unknown): any;
  createCommandEncoder(): any;
  queue: { writeBuffer(buffer: any, offset: number, data: ArrayBufferView): void; submit(commands: any[]): void };
}
declare const GPUBufferUsage: { STORAGE:number; COPY_DST:number; COPY_SRC:number; MAP_READ:number };
declare const GPUMapMode: { READ:number };
interface XRSystem { isSessionSupported(mode: string): Promise<boolean> }
interface Navigator { gpu?: GPU; xr?: XRSystem }
