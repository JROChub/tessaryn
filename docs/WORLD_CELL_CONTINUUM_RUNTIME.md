# World Cell continuum runtime

## Purpose

The World Cell Theater must construct a stable spatial-temporal locus, not a
screen-space effect. The live runtime therefore separates three products that
have different evidence strength:

1. the immediate forming field, which is a non-authoritative camera-aligned
   preview;
2. relative multi-view geometry, reconstructed from measured photometric and
   feature correspondences; and
3. metric geometry, admitted only when a host sensor adapter supplies
   synchronized axial depth in meters, calibrated intrinsics, a rigid
   world-from-camera pose, and the exact calibration receipt.

No forming sample or interpolated optical flow enters a Moment or Rootprint.

## Reconstruction path

```text
camera RGBA + source digest
  -> calibrated RGB-D + rigid spatial pose when the host supplies them
  -> exact back-projection and depth-discontinuity topology gates
  -> measured-normal triangle construction
  -> deterministic persistent surfel fusion
  -> stable capture-origin coordinate frame
  -> depth-writing native surfaces and participant navigation
  -> automatic authority-gated Moments
  -> eform / Power House seal and local re-verification
```

Without the spatial adapter, Keyxym executes bounded monocular tracking and
relative pose recovery. The Theater deliberately keeps the live camera visible
instead of presenting a sparse relative point field as an inhabitable place.
When capture stops, it freezes the final sensory frame and renders the
accumulated native relative triangles over that frame. The recovered result is
therefore inspectable without representing relative geometry as metric depth or
discarding the participant's last recognizable observation.

Pose tracks and surface samples are intentionally separate. Dense image
samples cannot vote a weak camera model into existence. Once a pose is accepted,
surface samples must independently pass patch uniqueness, forward/backward
consistency, positive depth, ray separation, finite range, and bounded angular
uncertainty.

## Continuity and scale

Distinct stationary observations preserve trajectory continuity but create no
baseline and no geometry. Exact duplicate source bytes create neither
continuity, trajectory, authority, nor geometry. Lost tracking freezes the
authoritative map; a bounded local re-anchor may resume odometry without
inventing the missing interval.

The generic browser camera path is relative scale. A host adapter installs the
`window.tessarynSpatialSensor` contract defined in
`apps/viewer-web/src/tessaryn-spatial-sensor.ts`. The Theater first freezes the
browser color bitmap, then identifies it by `mediaTime` and `presentedFrames`;
the adapter must return those values unchanged with the matched depth and pose.
Its calibration receipt is the
canonical digest of the device identifier, depth and pose conventions,
synchronization declaration, and exact `fx`, `fy`, `cx`, `cy`, width, and
height. Every color request must return depth and pose carrying the identical
nanosecond timestamp. The worker commits color, depth, pose, and receipt before
Keyxym ingestion. A typed reference length, transport connection, scale value,
or IMU stream is never sufficient to promote a Cell to metric status.

The receipt is a tamper-evident calibration commitment. Hardware authenticity
remains the responsibility of the installed trusted host adapter; the browser
does not claim that WebUSB or WebSerial transport alone authenticates a device.

## Stable inhabitation

The renderer converts the Keyxym +Z camera convention into the Three.js -Z
view convention once. It never recenters or rescales the evolving map. The
first camera pose remains the capture origin, occlusion uses depth-writing
geometry, and the participant can orbit, pan, dolly, or walk through the locus
with pointer, touch, wheel, and keyboard controls.

## Authority gates

A Moment still requires a recovered, nondegenerate pose, bounded reprojection,
minimum parallax, confirmed geometry, sustained continuity, and three nonzero
native receipts. Seal readiness additionally requires the stronger tracking,
geometry, and continuity thresholds. The Theater records a Moment immediately
when seal readiness is first reached and, when the local verified assurance
bridge is available, seals and verifies that exact geometry revision without
stopping capture. A bridge failure leaves the immutable seal-ready Moment
available for explicit retry.

## Sensor capability tiers

- **RGB-D, stereo, LiDAR, or WebXR/native depth with verified calibration:**
  metric dense fusion and metric sealing are physically supportable.
- **Calibrated monocular RGB:** relative multi-view surfaces and relative
  sealing are supportable; absolute human-scale distance is not inferred.
- **Uncalibrated monocular RGB:** the runtime uses an explicit approximate
  optical model, remains relative, and exposes that limitation in evidence.
- **No defensible motion or texture:** the preview may continue, while geometry,
  Moments, and sealing remain frozen.

The deterministic RGB-D reconstruction and sparse-SDF kernel remains the
highest-density authoritative path. The live monocular path does not pretend
to replace depth hardware or to infer absolute scale from appearance.
