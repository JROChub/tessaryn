# Anchor v0

An Anchor is a local fixed-point metric frame. It has a stable digest, integer
translation, Q30 orientation, parts-per-billion scale, uncertainty, temporal
validity, and source records.

Transform composition is deterministic and checked for overflow. Candidate
paths remain separate. When path results differ beyond declared tolerance, the
query returns a divergence record and never silently averages them.

Latitude and longitude may be adapter outputs later. They are not the native
coordinate authority.
