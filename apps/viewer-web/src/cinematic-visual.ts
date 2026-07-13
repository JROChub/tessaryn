import "./compressed-cinematic-fetch";
import * as THREE from "three";
import { CinematicObjectVisual as ContinuumMonumentVisual } from "./continuum-monument-visual";
import { LogoMansionVisual } from "./logo-mansion-visual.js";
import type { CinematicObjectDescriptorView } from "./types";

const LOGO_MANSION_OBJECT_ID = "tessaryn-logo-mansion-01";
type NativeCinematicVisual = ContinuumMonumentVisual | LogoMansionVisual;

/** Selects the committed procedural constructor without changing the viewer API. */
export class CinematicObjectVisual {
  readonly root: THREE.Group;
  readonly interactive: THREE.Object3D[];
  readonly materials: THREE.Material[];
  readonly radius: number;
  readonly focus: THREE.Vector3;

  private readonly visual: NativeCinematicVisual;

  constructor(
    descriptor: CinematicObjectDescriptorView,
    media: Blob,
    constrained: boolean,
  ) {
    this.visual =
      descriptor.object_id === LOGO_MANSION_OBJECT_ID
        ? new LogoMansionVisual(descriptor, media, constrained)
        : new ContinuumMonumentVisual(descriptor, media, constrained);
    this.root = this.visual.root;
    this.interactive = this.visual.interactive;
    this.materials = this.visual.materials;
    this.radius = this.visual.radius;
    this.focus = this.visual.focus;
  }

  get phaseCount(): number {
    return this.visual.phaseCount;
  }

  get semanticCount(): number {
    return this.visual.semanticCount;
  }

  get activeSemanticCount(): number {
    return this.visual.activeSemanticCount;
  }

  ready(): Promise<void> {
    return this.visual.ready();
  }

  setCellKey(key: string): void {
    this.visual.setCellKey(key);
  }

  setChronofold(active: boolean): void {
    this.visual.setChronofold(active);
  }

  setEvidence(active: boolean): void {
    this.visual.setEvidence(active);
  }

  setMoment(id: string): boolean {
    return this.visual.setMoment(id);
  }

  setTemporalPosition(value: number): void {
    this.visual.setTemporalPosition(value);
  }

  temporalPosition(): number {
    return this.visual.temporalPosition();
  }

  isPlaying(): boolean {
    return this.visual.isPlaying();
  }

  setPlaying(active: boolean): Promise<void> {
    return this.visual.setPlaying(active);
  }

  animate(seconds: number, delta: number, scaleDepth: number): void {
    this.visual.animate(seconds, delta, scaleDepth);
  }

  destroy(): void {
    this.visual.destroy();
  }
}
