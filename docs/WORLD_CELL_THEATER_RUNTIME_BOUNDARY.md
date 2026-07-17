# World Cell Theater runtime boundary

The browser Theater is a visualization, capture-control, Moment, evidence, and transfer surface.

It must not independently claim metric reconstruction merely by deriving depth from RGB intensity or by accumulating image-space preview samples.

The authoritative v0.26 calibrated spatial reconstruction implementation
belongs to `JROChub/keyxym_map` and is shipped as a source-exact, digest-pinned
WebAssembly runtime.

Tessaryn metric reconstruction consumes one of the following concrete Keyxym
runtime products:

- a native mobile SDK session;
- the bundled WebAssembly build exposing the v0.26 spatial session contract;
- a verified canonical World Cell produced externally and transferred into the Theater.

The browser integration is active. Metric status requires synchronized axial
depth in meters, calibrated intrinsics, a rigid row-major world-from-camera
pose, and the canonical calibration receipt through the exported
`TessarynSpatialSensor` contract. The worker binds all of those bytes into the
source commitment before calling Keyxym. Scale-only input is rejected in both
the browser and native authority.

Ordinary monocular capture remains useful as a live relative preview, but it
does not render sparse points as a finished place and never claims metric
geometry. WebUSB, WebSerial, WebXR availability, an IMU, or a typed reference
length does not independently activate metric authority.
