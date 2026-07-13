import * as THREE from "three";

const COLORS = ["#9bb568", "#74c8c1", "#d18662"];

export class LogoMansion {
  constructor(descriptor, mediaTexture, constrained) {
    this.descriptor = descriptor;
    this.mediaTexture = mediaTexture;
    this.constrained = constrained;
    this.root = new THREE.Group();
    this.root.name = "tessaryn-logo-mansion";
    this.interactive = [];
    this.materials = [];
    this.geometries = [];
    this.wings = [];
    this.portals = [];
    this.buildSite();
    this.buildWings();
    this.buildBridges();
    this.buildAtrium();
  }

  material(color, accent = color, transparent = false, opacity = 1) {
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: new THREE.Color(accent).multiplyScalar(0.05),
      specular: new THREE.Color(accent).lerp(new THREE.Color("#c8c0aa"), 0.25),
      shininess: 38,
      transparent,
      opacity,
      depthWrite: opacity > 0.95,
      side: THREE.DoubleSide,
    });
    this.materials.push(material);
    return material;
  }

  mesh(geometry, material, name) {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }

  buildSite() {
    const terrace = this.mesh(new THREE.CylinderGeometry(5.35, 5.65, 0.2, 4), this.material("#141813"), "mansion-site-terrace");
    terrace.position.y = -3.15;
    terrace.rotation.y = Math.PI / 4;
    terrace.receiveShadow = !this.constrained;
    this.root.add(terrace);
    const court = this.mesh(new THREE.CylinderGeometry(4.92, 5.08, 0.08, 4), this.material("#282a22"), "mansion-continuum-court");
    court.position.y = -3.01;
    court.rotation.y = Math.PI / 4;
    this.root.add(court);
    const points = [];
    for (const radius of [1.3, 2.35, 3.75, 4.68]) {
      const corners = diamondCorners(radius, -2.95);
      for (let index = 0; index < 4; index += 1) points.push(corners[index], corners[(index + 1) % 4]);
    }
    const material = new THREE.LineBasicMaterial({ color: "#a49c81", transparent: true, opacity: 0.48 });
    this.materials.push(material);
    const inlay = new THREE.LineSegments(this.track(new THREE.BufferGeometry().setFromPoints(points)), material);
    this.root.add(inlay);
  }

  buildWings() {
    const plans = [
      { id: "olive", name: "OLIVE ARCHIVE WING", center: [-1.42, -1.38], radius: 3.04, levels: 2, accent: COLORS[0], stone: "#30382a", roof: "#20271f", separation: [-0.85, -0.78], phase: 0 },
      { id: "teal", name: "TEAL OBSERVATORY WING", center: [1.42, 1.38], radius: 3.04, levels: 2, accent: COLORS[1], stone: "#293b3a", roof: "#1e2d2e", separation: [0.85, 0.78], phase: 1 / 3 },
      { id: "ember", name: "EMBER MEMORY WING", center: [0, 0], radius: 2.08, levels: 3, accent: COLORS[2], stone: "#48332c", roof: "#35231f", separation: [0, -0.28], phase: 2 / 3 },
    ];
    for (const plan of plans) {
      const group = new THREE.Group();
      group.position.set(plan.center[0], 0, plan.center[1]);
      group.name = `mansion-wing-${plan.id}`;
      const stone = this.material(plan.stone, plan.accent);
      const trim = this.material(plan.accent, plan.accent);
      const glass = this.material(new THREE.Color(plan.accent).multiplyScalar(0.4), plan.accent, true, 0.76);
      glass.emissiveIntensity = 0.34;
      const corners = diamondCorners(plan.radius, 0);
      for (let level = 0; level < plan.levels; level += 1) {
        const y = -2.5 + level * 1.05;
        for (let edge = 0; edge < 4; edge += 1) {
          const start = corners[edge];
          const end = corners[(edge + 1) % 4];
          const direction = end.clone().sub(start);
          const length = direction.length();
          const angle = -Math.atan2(direction.z, direction.x);
          const wall = this.mesh(new THREE.BoxGeometry(length * 0.96, 0.88, 0.18), stone, `${plan.id}-wall`);
          wall.position.copy(start).lerp(end, 0.5);
          wall.position.y = y;
          wall.rotation.y = angle;
          wall.castShadow = !this.constrained;
          wall.userData.space = space(plan, level + 1, "GALLERY", wall.position);
          group.add(wall);
          this.interactive.push(wall);
          const windows = this.mesh(new THREE.BoxGeometry(length * 0.64, 0.4, 0.04), glass, `${plan.id}-windows`);
          windows.position.copy(wall.position);
          windows.position.y += 0.05;
          windows.rotation.y = angle;
          windows.translateZ(-0.11);
          group.add(windows);
        }
        const band = this.edgeBand(corners, y + 0.53, 0.1, trim, `${plan.id}-band`);
        group.add(band);
      }
      const roof = this.mesh(diamondRoofGeometry(plan.radius * 0.99, plan.id === "ember" ? 1.12 : 0.92), this.material(plan.roof, plan.accent), `${plan.id}-roof`);
      roof.position.y = -2.5 + plan.levels * 1.05 - 0.36;
      roof.castShadow = !this.constrained;
      group.add(roof);
      this.root.add(group);
      this.wings.push({ plan, group, base: group.position.clone(), roof, roofBaseY: roof.position.y, glass });
    }
  }

  edgeBand(corners, y, thickness, material, name) {
    const group = new THREE.Group();
    group.name = name;
    for (let edge = 0; edge < 4; edge += 1) {
      const start = corners[edge];
      const end = corners[(edge + 1) % 4];
      const direction = end.clone().sub(start);
      const beam = this.mesh(new THREE.BoxGeometry(direction.length(), thickness, 0.22), material, name);
      beam.position.copy(start).lerp(end, 0.5);
      beam.position.y = y;
      beam.rotation.y = -Math.atan2(direction.z, direction.x);
      group.add(beam);
    }
    return group;
  }

  buildBridges() {
    for (const wing of this.wings) {
      const origin = wing.base.clone();
      origin.y = -0.82;
      const direction = origin.clone().multiplyScalar(-1);
      const length = Math.max(0.6, direction.length() - 0.9);
      direction.setLength(length);
      const bridge = this.mesh(new THREE.BoxGeometry(length, 0.14, 0.48), this.material(wing.plan.accent, wing.plan.accent, true, 0.38), `${wing.plan.id}-bridge`);
      bridge.position.copy(origin).add(direction.clone().multiplyScalar(0.5));
      bridge.rotation.y = -Math.atan2(direction.z, direction.x);
      bridge.userData.space = space(wing.plan, 2, "CONTINUUM BRIDGE", bridge.position);
      this.root.add(bridge);
      this.interactive.push(bridge);
    }
  }

  buildAtrium() {
    const frames = [
      { x: -0.36, y: 0.12, z: -1.78, size: 2.18, accent: COLORS[0], yaw: 0.05 },
      { x: 0.36, y: -0.18, z: 0, size: 2.18, accent: COLORS[1], yaw: -0.065 },
      { x: 0.08, y: 0.16, z: 1.78, size: 1.58, accent: COLORS[2], yaw: 0.12 },
    ];
    frames.forEach((frame, index) => {
      const group = new THREE.Group();
      group.position.set(frame.x, frame.y, frame.z);
      group.rotation.y = frame.yaw;
      const ring = this.mesh(diamondFrameGeometry(frame.size, frame.size * 0.065, 0.16), this.material(frame.accent, frame.accent), `identity-portal-${String(index + 1)}`);
      ring.userData.space = { id: `portal-${String(index + 1)}`, name: `IDENTITY PORTAL ${String(index + 1)}`, meta: `${["OLIVE", "TEAL", "EMBER"][index]} FRAME / TEMPORAL ATRIUM`, detail: "One of the three overlapping TESSARYN logo frames made architectural and traversable." };
      group.add(ring);
      this.interactive.push(ring);
      const paneMaterial = new THREE.MeshBasicMaterial({ map: this.mediaTexture, color: frame.accent, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      this.materials.push(paneMaterial);
      const pane = this.mesh(new THREE.PlaneGeometry(frame.size * 1.16, frame.size * 1.16), paneMaterial, `memory-pane-${String(index + 1)}`);
      pane.rotation.z = Math.PI / 4;
      pane.position.z = 0.012;
      group.add(pane);
      this.root.add(group);
      this.portals.push({ group, base: group.position.clone(), pane: paneMaterial, phase: index / 3 });
    });
    this.core = this.mesh(new THREE.IcosahedronGeometry(0.92, this.constrained ? 1 : 3), this.material("#d8d0bb", "#9ab2a3"), "temporal-memory-core");
    this.core.scale.set(0.72, 1.34, 0.72);
    this.core.userData.space = { id: "atrium", name: "CENTRAL MEMORY ATRIUM", meta: "ROOTPRINT HEART / ALL LEVELS", detail: this.descriptor.slbit.summary };
    this.root.add(this.core);
    this.interactive.push(this.core);
  }

  animate(seconds, delta, temporal, fold) {
    const wave = temporal * Math.PI * 2;
    const motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1;
    for (const wing of this.wings) {
      const phase = wave + wing.plan.phase * Math.PI * 2;
      const target = wing.base.clone().add(new THREE.Vector3(wing.plan.separation[0], 0, wing.plan.separation[1]).multiplyScalar(fold * 0.58));
      target.y += Math.sin(phase) * 0.025 * motion;
      if (wing.plan.id === "ember") target.y += fold * 0.22;
      wing.group.position.lerp(target, 1 - Math.exp(-delta * 5.4));
      wing.roof.position.y = THREE.MathUtils.damp(wing.roof.position.y, wing.roofBaseY + Math.sin(phase + 0.8) * 0.025 * motion + fold * 0.04, 5.5, delta);
      wing.glass.emissiveIntensity = 0.24 + 0.28 * (0.5 + 0.5 * Math.sin(phase + 0.4));
    }
    this.portals.forEach((portal, index) => {
      const target = portal.base.clone();
      target.z += (index - 1) * fold * 1.12;
      portal.group.position.lerp(target, 1 - Math.exp(-delta * 6));
      portal.pane.opacity = 0.18 + 0.13 * (0.5 + 0.5 * Math.sin(wave + portal.phase * Math.PI * 2));
    });
    const pulse = 1 + Math.sin(seconds * 0.45 + wave) * 0.025 * motion;
    this.core.scale.set(0.72 * pulse, 1.34 * pulse, 0.72 * pulse);
    this.core.rotation.y += delta * 0.05 * motion;
    this.root.rotation.y = Math.sin(seconds * 0.075) * 0.014 * motion;
  }

  diagnostics() { return { wings: this.wings.length, portals: this.portals.length, interactiveSpaces: this.interactive.length }; }
  track(geometry) { this.geometries.push(geometry); return geometry; }
  destroy() {
    for (const geometry of new Set(this.geometries)) geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
    this.root.clear();
  }
}

function space(plan, level, kind, position) {
  return { id: `${plan.id}-${String(level)}-${kind.toLowerCase().replaceAll(" ", "-")}`, name: `${plan.name} / ${kind}`, meta: `${plan.accent.toUpperCase()} / LEVEL ${String(level)}`, detail: `An inhabitable ${plan.id} Cell wing derived directly from one of the three overlapping TESSARYN logo frames.`, focus: [position.x, position.y, position.z] };
}
function diamondCorners(radius, y) { return [new THREE.Vector3(0, y, radius), new THREE.Vector3(radius, y, 0), new THREE.Vector3(0, y, -radius), new THREE.Vector3(-radius, y, 0)]; }
function diamondRoofGeometry(radius, height) {
  const apex = [0, height, 0];
  const corners = [[0, 0, radius], [radius, 0, 0], [0, 0, -radius], [-radius, 0, 0]];
  const positions = [];
  for (let index = 0; index < 4; index += 1) positions.push(...apex, ...corners[index], ...corners[(index + 1) % 4]);
  positions.push(...corners[0], ...corners[2], ...corners[1], ...corners[0], ...corners[3], ...corners[2]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
function diamondFrameGeometry(size, thickness, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(0, size); shape.lineTo(size, 0); shape.lineTo(0, -size); shape.lineTo(-size, 0); shape.closePath();
  const hole = new THREE.Path();
  const inner = size - thickness;
  hole.moveTo(0, inner); hole.lineTo(inner, 0); hole.lineTo(0, -inner); hole.lineTo(-inner, 0); hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, bevelSize: Math.min(0.07, thickness * 0.2), bevelThickness: 0.05, curveSegments: 4, steps: 1 });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}
