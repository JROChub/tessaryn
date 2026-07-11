# Scale Continuity

Title: Continuous object-room-site Scale Breathing
Owner: MFENX engineering
Status: supported
Hypothesis: A selected object can remain the perceptual anchor across a continuous bounded scale field.
Why it matters: TESSARYN must not reduce scale to map zoom.
Smallest prototype: TUM Freiburg desk SDF Cell across object, room, and site anchor depths.
Input dataset: real TUM Freiburg1 desk temporal Origin.
Success metric: Selection identity and perceptual focus persist through object, room, and site transitions in automated interaction replay.
Failure threshold: Selection changes, leaves the view unexpectedly, or loses its deterministic correspondence during a transition.
Fallback: Discrete but animated scale states with explicit correspondences.
Security and privacy implications: Aggregate state must not reveal restricted geometry.
Power House integration: Presentation transforms preserve the `0.2.0` Cell and
Rootprint identities.
Measured result: Automated desktop, portrait, landscape, and reduced-motion interaction replay preserves selection and verification state.
Decision: Supported for the continuous bounded `0.2.0` scale field. Broader
human-comprehension studies may extend the design.
