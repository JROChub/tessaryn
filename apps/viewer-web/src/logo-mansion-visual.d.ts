import * as THREE from "three";
import type { CinematicObjectDescriptorView } from "./types";

export class LogoMansionVisual {
  readonly root: THREE.Group;
  readonly interactive: THREE.Object3D[];
  readonly materials: THREE.Material[];
  readonly radius: number;
  readonly focus: THREE.Vector3;
  readonly phaseCount: number;
  readonly semanticCount: number;
  readonly activeSemanticCount: number;
  constructor(descriptor: CinematicObjectDescriptorView, media: Blob, constrained: boolean);
  ready(): Promise<void>;
  setCellKey(key: string): void;
  setChronofold(active: boolean): void;
  setEvidence(active: boolean): void;
  setMoment(id: string): boolean;
  setTemporalPosition(value: number): void;
  temporalPosition(): number;
  isPlaying(): boolean;
  setPlaying(active: boolean): Promise<void>;
  animate(seconds: number, delta: number, scaleDepth: number): void;
  destroy(): void;
}
