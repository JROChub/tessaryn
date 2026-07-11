//! Deterministic fixed-point local coordinate frames and transform paths.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tessaryn_schema::Digest;
use thiserror::Error;

const Q30: i128 = 1_i128 << 30;
const PARTS_PER_BILLION: i128 = 1_000_000_000;

/// One local metric frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    /// Stable Anchor identity.
    pub id: Digest,
    /// Human-facing local label.
    pub label: String,
    /// Cell that established the frame.
    pub origin_cell: Digest,
    /// Earliest valid Unix microsecond.
    pub valid_from_unix_us: i64,
    /// Latest valid Unix microsecond.
    pub valid_until_unix_us: i64,
}

/// Deterministic similarity transform between two Anchors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorTransform {
    /// Stable edge identity.
    pub edge_id: Digest,
    /// Source Anchor.
    pub from_anchor: Digest,
    /// Destination Anchor.
    pub to_anchor: Digest,
    /// Translation in source-frame micrometers.
    pub translation_um: [i64; 3],
    /// Rotation quaternion in Q30 x/y/z/w order.
    pub rotation_q30: [i32; 4],
    /// Uniform scale in parts per billion; one billion is identity.
    pub scale_ppb: u64,
    /// Declared uncertainty in micrometers.
    pub uncertainty_um: [u64; 3],
    /// First valid Unix microsecond.
    pub valid_from_unix_us: i64,
    /// Last valid Unix microsecond.
    pub valid_until_unix_us: i64,
    /// Source Cells supporting this transform.
    pub source_cells: Vec<Digest>,
}

impl AnchorTransform {
    /// Returns an identity transform between two frames.
    pub fn identity(edge_id: Digest, from_anchor: Digest, to_anchor: Digest) -> Self {
        Self {
            edge_id,
            from_anchor,
            to_anchor,
            translation_um: [0; 3],
            rotation_q30: [0, 0, 0, 1 << 30],
            scale_ppb: 1_000_000_000,
            uncertainty_um: [0; 3],
            valid_from_unix_us: i64::MIN,
            valid_until_unix_us: i64::MAX,
            source_cells: Vec::new(),
        }
    }

    /// Validates fixed-point and temporal invariants.
    pub fn validate(&self) -> Result<(), AnchorError> {
        if self.from_anchor == self.to_anchor {
            return Err(AnchorError::SelfEdge(self.from_anchor.clone()));
        }
        if self.scale_ppb == 0 {
            return Err(AnchorError::InvalidScale);
        }
        if self.valid_from_unix_us > self.valid_until_unix_us {
            return Err(AnchorError::InvalidInterval);
        }
        validate_quaternion(self.rotation_q30)
    }
}

/// One candidate transform and the exact path that produced it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransformCandidate {
    /// Edge IDs in traversal order.
    pub path: Vec<Digest>,
    /// Composed transform.
    pub transform: AnchorTransform,
}

/// Conflict-preserving transform resolution result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransformResolution {
    /// Deterministically ordered candidate paths.
    pub candidates: Vec<TransformCandidate>,
    /// True when candidates disagree beyond declared tolerance.
    pub divergent: bool,
}

/// Anchor and transform graph.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnchorGraph {
    anchors: BTreeMap<Digest, Anchor>,
    edges: BTreeMap<Digest, AnchorTransform>,
}

impl AnchorGraph {
    /// Inserts one Anchor.
    pub fn add_anchor(&mut self, anchor: Anchor) -> Result<(), AnchorError> {
        if anchor.label.trim().is_empty() || anchor.valid_from_unix_us > anchor.valid_until_unix_us
        {
            return Err(AnchorError::InvalidAnchor(anchor.id));
        }
        if self.anchors.contains_key(&anchor.id) {
            return Err(AnchorError::DuplicateAnchor);
        }
        self.anchors.insert(anchor.id.clone(), anchor);
        Ok(())
    }

    /// Inserts one transform without collapsing alternate hypotheses.
    pub fn add_transform(&mut self, mut transform: AnchorTransform) -> Result<(), AnchorError> {
        transform.validate()?;
        if !self.anchors.contains_key(&transform.from_anchor)
            || !self.anchors.contains_key(&transform.to_anchor)
        {
            return Err(AnchorError::MissingAnchor);
        }
        transform.source_cells.sort();
        transform.source_cells.dedup();
        if self.edges.contains_key(&transform.edge_id) {
            return Err(AnchorError::DuplicateTransform);
        }
        self.edges.insert(transform.edge_id.clone(), transform);
        Ok(())
    }

    /// Returns all simple transform paths up to `max_depth` and preserves divergence.
    pub fn resolve(
        &self,
        from: &Digest,
        to: &Digest,
        at_unix_us: i64,
        max_depth: usize,
    ) -> Result<TransformResolution, AnchorError> {
        if !self.anchors.contains_key(from) || !self.anchors.contains_key(to) {
            return Err(AnchorError::MissingAnchor);
        }
        if from == to {
            return Err(AnchorError::SameResolutionAnchor);
        }
        let mut candidates = Vec::new();
        let mut visited = BTreeSet::new();
        visited.insert(from.clone());
        self.walk_paths(
            from,
            to,
            at_unix_us,
            max_depth.min(32),
            &mut visited,
            Vec::new(),
            None,
            &mut candidates,
        )?;
        if candidates.is_empty() {
            return Err(AnchorError::NoPath);
        }
        candidates.sort_by(|left, right| left.path.cmp(&right.path));
        let first = &candidates[0].transform;
        let divergent = candidates
            .iter()
            .skip(1)
            .any(|candidate| transforms_diverge(first, &candidate.transform));
        Ok(TransformResolution {
            candidates,
            divergent,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn walk_paths(
        &self,
        current: &Digest,
        target: &Digest,
        at_unix_us: i64,
        depth_left: usize,
        visited: &mut BTreeSet<Digest>,
        path: Vec<Digest>,
        composed: Option<AnchorTransform>,
        candidates: &mut Vec<TransformCandidate>,
    ) -> Result<(), AnchorError> {
        if depth_left == 0 {
            return Ok(());
        }
        let mut outgoing = self
            .edges
            .values()
            .filter(|edge| {
                &edge.from_anchor == current
                    && edge.valid_from_unix_us <= at_unix_us
                    && edge.valid_until_unix_us >= at_unix_us
            })
            .collect::<Vec<_>>();
        outgoing.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
        for edge in outgoing {
            if visited.contains(&edge.to_anchor) {
                continue;
            }
            let next_transform = match &composed {
                Some(existing) => compose(existing, edge)?,
                None => edge.clone(),
            };
            let mut next_path = path.clone();
            next_path.push(edge.edge_id.clone());
            if &edge.to_anchor == target {
                candidates.push(TransformCandidate {
                    path: next_path,
                    transform: next_transform,
                });
                continue;
            }
            visited.insert(edge.to_anchor.clone());
            self.walk_paths(
                &edge.to_anchor,
                target,
                at_unix_us,
                depth_left - 1,
                visited,
                next_path,
                Some(next_transform),
                candidates,
            )?;
            visited.remove(&edge.to_anchor);
        }
        Ok(())
    }
}

/// Composes `left` followed by `right` using deterministic integer arithmetic.
pub fn compose(
    left: &AnchorTransform,
    right: &AnchorTransform,
) -> Result<AnchorTransform, AnchorError> {
    if left.to_anchor != right.from_anchor {
        return Err(AnchorError::DisconnectedComposition);
    }
    let rotated = rotate_vector(left.rotation_q30, right.translation_um)?;
    let mut translation = [0_i64; 3];
    let mut uncertainty = [0_u64; 3];
    for axis in 0..3 {
        let scaled = round_div(
            i128::from(rotated[axis]) * i128::from(left.scale_ppb),
            PARTS_PER_BILLION,
        );
        translation[axis] = checked_i64(i128::from(left.translation_um[axis]) + scaled)?;
        uncertainty[axis] = left.uncertainty_um[axis].saturating_add(right.uncertainty_um[axis]);
    }
    let scale = round_div(
        i128::from(left.scale_ppb) * i128::from(right.scale_ppb),
        PARTS_PER_BILLION,
    );
    let rotation_q30 = multiply_quaternion(left.rotation_q30, right.rotation_q30)?;
    let mut source_cells = left.source_cells.clone();
    source_cells.extend(right.source_cells.clone());
    source_cells.sort();
    source_cells.dedup();
    Ok(AnchorTransform {
        edge_id: right.edge_id.clone(),
        from_anchor: left.from_anchor.clone(),
        to_anchor: right.to_anchor.clone(),
        translation_um: translation,
        rotation_q30,
        scale_ppb: u64::try_from(scale).map_err(|_| AnchorError::Overflow)?,
        uncertainty_um: uncertainty,
        valid_from_unix_us: left.valid_from_unix_us.max(right.valid_from_unix_us),
        valid_until_unix_us: left.valid_until_unix_us.min(right.valid_until_unix_us),
        source_cells,
    })
}

/// Anchor graph error.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum AnchorError {
    /// An Anchor was malformed.
    #[error("invalid Anchor: {0}")]
    InvalidAnchor(Digest),
    /// An Anchor already existed.
    #[error("duplicate Anchor")]
    DuplicateAnchor,
    /// A transform already existed.
    #[error("duplicate transform")]
    DuplicateTransform,
    /// A referenced Anchor does not exist.
    #[error("referenced Anchor does not exist")]
    MissingAnchor,
    /// Self edges are not admitted.
    #[error("self transform is not admitted: {0}")]
    SelfEdge(Digest),
    /// Scale was zero.
    #[error("scale_ppb must be nonzero")]
    InvalidScale,
    /// Validity interval was inverted.
    #[error("transform validity interval is inverted")]
    InvalidInterval,
    /// Quaternion was outside the Q30 unit tolerance.
    #[error("rotation_q30 is not a unit quaternion")]
    InvalidQuaternion,
    /// The requested path does not exist.
    #[error("no transform path exists")]
    NoPath,
    /// Same-frame resolution should be handled as identity by the caller.
    #[error("source and destination Anchor are identical")]
    SameResolutionAnchor,
    /// Composition endpoints did not meet.
    #[error("transform composition is disconnected")]
    DisconnectedComposition,
    /// Fixed-point arithmetic overflowed.
    #[error("fixed-point transform overflow")]
    Overflow,
}

fn validate_quaternion(value: [i32; 4]) -> Result<(), AnchorError> {
    let norm = value
        .into_iter()
        .map(|component| i128::from(component) * i128::from(component))
        .sum::<i128>();
    let expected = Q30 * Q30;
    if (norm - expected).abs() > expected / 500 {
        return Err(AnchorError::InvalidQuaternion);
    }
    Ok(())
}

fn multiply_quaternion(left: [i32; 4], right: [i32; 4]) -> Result<[i32; 4], AnchorError> {
    let [lx, ly, lz, lw] = left.map(i128::from);
    let [rx, ry, rz, rw] = right.map(i128::from);
    let products = [
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
        lw * rw - lx * rx - ly * ry - lz * rz,
    ];
    let mut output = [0_i32; 4];
    for (index, product) in products.into_iter().enumerate() {
        output[index] =
            i32::try_from(round_div(product, Q30)).map_err(|_| AnchorError::Overflow)?;
    }
    validate_quaternion(output)?;
    Ok(output)
}

fn rotate_vector(rotation: [i32; 4], vector: [i64; 3]) -> Result<[i64; 3], AnchorError> {
    let [qx, qy, qz, qw] = rotation.map(i128::from);
    let [vx, vy, vz] = vector.map(i128::from);
    let tx = round_div(2 * (qy * vz - qz * vy), Q30);
    let ty = round_div(2 * (qz * vx - qx * vz), Q30);
    let tz = round_div(2 * (qx * vy - qy * vx), Q30);
    let output = [
        vx + round_div(qw * tx + qy * tz - qz * ty, Q30),
        vy + round_div(qw * ty + qz * tx - qx * tz, Q30),
        vz + round_div(qw * tz + qx * ty - qy * tx, Q30),
    ];
    Ok([
        checked_i64(output[0])?,
        checked_i64(output[1])?,
        checked_i64(output[2])?,
    ])
}

fn transforms_diverge(left: &AnchorTransform, right: &AnchorTransform) -> bool {
    let translation_diverges = (0..3).any(|axis| {
        let tolerance = left.uncertainty_um[axis]
            .saturating_add(right.uncertainty_um[axis])
            .saturating_add(1_000);
        left.translation_um[axis].abs_diff(right.translation_um[axis]) > tolerance
    });
    let rotation_diverges = (0..4)
        .any(|axis| left.rotation_q30[axis].abs_diff(right.rotation_q30[axis]) > (1_u32 << 18));
    let scale_diverges = left.scale_ppb.abs_diff(right.scale_ppb) > 10_000;
    translation_diverges || rotation_diverges || scale_diverges
}

fn round_div(numerator: i128, denominator: i128) -> i128 {
    if numerator >= 0 {
        (numerator + denominator / 2) / denominator
    } else {
        (numerator - denominator / 2) / denominator
    }
}

fn checked_i64(value: i128) -> Result<i64, AnchorError> {
    i64::try_from(value).map_err(|_| AnchorError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(value: u8) -> Digest {
        Digest::new(format!("sha256:{value:02x}{}", "00".repeat(31))).unwrap()
    }

    fn anchor(value: u8) -> Anchor {
        Anchor {
            id: digest(value),
            label: format!("anchor-{value}"),
            origin_cell: digest(value + 20),
            valid_from_unix_us: 0,
            valid_until_unix_us: 100,
        }
    }

    fn edge(id: u8, from: u8, to: u8, x: i64) -> AnchorTransform {
        let mut value = AnchorTransform::identity(digest(id), digest(from), digest(to));
        value.translation_um = [x, 0, 0];
        value.valid_from_unix_us = 0;
        value.valid_until_unix_us = 100;
        value.uncertainty_um = [10, 10, 10];
        value
    }

    #[test]
    fn composition_is_deterministic() {
        let left = edge(10, 1, 2, 100);
        let right = edge(11, 2, 3, 250);
        let result = compose(&left, &right).unwrap();
        assert_eq!(result.translation_um, [350, 0, 0]);
        assert_eq!(result.from_anchor, digest(1));
        assert_eq!(result.to_anchor, digest(3));
    }

    #[test]
    fn alternate_paths_are_preserved_as_divergence() {
        let mut graph = AnchorGraph::default();
        for value in 1..=4 {
            graph.add_anchor(anchor(value)).unwrap();
        }
        graph.add_transform(edge(10, 1, 2, 100)).unwrap();
        graph.add_transform(edge(11, 2, 4, 100)).unwrap();
        graph.add_transform(edge(12, 1, 3, 100)).unwrap();
        graph.add_transform(edge(13, 3, 4, 20_000)).unwrap();
        let resolution = graph.resolve(&digest(1), &digest(4), 50, 8).unwrap();
        assert_eq!(resolution.candidates.len(), 2);
        assert!(resolution.divergent);
    }

    #[test]
    fn translation_composition_is_associative_across_generated_cases() {
        let mut state = 0x243f_6a88_u32;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            i64::from(state % 2_000_001) - 1_000_000
        };
        for case in 0..2_048_u64 {
            let mut left = edge(10, 1, 2, next());
            let mut middle = edge(11, 2, 3, next());
            let mut right = edge(12, 3, 4, next());
            left.translation_um[1] = next();
            middle.translation_um[1] = next();
            right.translation_um[1] = next();
            left.translation_um[2] = next();
            middle.translation_um[2] = next();
            right.translation_um[2] = next();
            let left_grouped = compose(&compose(&left, &middle).unwrap(), &right).unwrap();
            let right_grouped = compose(&left, &compose(&middle, &right).unwrap()).unwrap();
            assert_eq!(
                left_grouped.translation_um, right_grouped.translation_um,
                "translation composition diverged for generated case {case}"
            );
        }
    }
}
