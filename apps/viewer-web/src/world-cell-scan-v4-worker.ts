interface ScanFramePayload {
  index: number;
  width: number;
  height: number;
  luma: Float32Array;
  rgba: Uint8ClampedArray;
}

interface PixelMatch {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  error: number;
  residual: number;
}

interface NormalizedMatch extends PixelMatch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface RelativePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  error: number;
}

interface SolveMetrics {
  keyframes: number;
  pair: [number, number];
  matches: number;
  inliers: number;
  reconstructed: number;
  positiveDepthRatio: number;
  reprojectionErrorPixels: number;
  parallaxDegrees: number;
  coverage: number;
  triangulationAngleDegrees: number;
  rotationOnlyErrorPixels: number;
  rotationOnlyInlierRatio: number;
  processingMs: number;
}

interface SolveSuccess {
  type: "result";
  ok: true;
  points: RelativePoint[];
  metrics: SolveMetrics;
}

interface SolveFailure {
  type: "result";
  ok: false;
  reason: string;
  metrics: Partial<SolveMetrics> & { keyframes: number; processingMs: number };
}

interface SolveRequest {
  type: "solve";
  frames: ScanFramePayload[];
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<SolveRequest>) => void) | null;
  postMessage(message: SolveSuccess | SolveFailure): void;
}

interface Feature {
  x: number;
  y: number;
  score: number;
}

interface EssentialEstimate {
  matrix: number[];
  inliers: NormalizedMatch[];
}

interface PoseCandidate {
  rotation: number[];
  translation: number[];
}

interface TriangulatedPoint {
  position: [number, number, number];
  depth1: number;
  depth2: number;
  errorPixels: number;
  angleDegrees: number;
  match: NormalizedMatch;
}

interface PairSelection {
  pair: [number, number];
  matches: PixelMatch[];
  coverage: number;
  medianFlow: number;
  score: number;
}

const scope = globalThis as unknown as WorkerScope;
const EPSILON = 1e-10;
const MIN_MATCHES = 24;
const MIN_RECONSTRUCTED_POINTS = 16;
const MAX_OUTPUT_POINTS = 900;
const ROTATION_ONLY_INLIER_PIXELS = 1.5;
const ROTATION_ONLY_MAX_MEDIAN_ERROR_PIXELS = 1.25;
const ROTATION_ONLY_MIN_INLIERS = 16;
const ROTATION_ONLY_MIN_INLIER_RATIO = 0.6;
const ROTATION_ONLY_MAX_ORTHOGONALITY_ERROR = 0.12;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const median = (values: number[]): number => {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
};

function identity(size: number): number[] {
  const output = new Array<number>(size * size).fill(0);
  for (let index = 0; index < size; index += 1) output[index * size + index] = 1;
  return output;
}

function jacobiEigenSymmetric(
  input: number[],
  size: number,
  maximumSweeps = 96,
): { values: number[]; vectors: number[] } {
  const matrix = [...input];
  const vectors = identity(size);
  for (let sweep = 0; sweep < maximumSweeps; sweep += 1) {
    let maximum = 0;
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const offDiagonal = matrix[p * size + q] ?? 0;
        maximum = Math.max(maximum, Math.abs(offDiagonal));
        if (Math.abs(offDiagonal) < 1e-12) continue;
        const diagonalP = matrix[p * size + p] ?? 0;
        const diagonalQ = matrix[q * size + q] ?? 0;
        const tau = (diagonalQ - diagonalP) / (2 * offDiagonal);
        const tangent = (tau >= 0 ? 1 : -1) /
          (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const cosine = 1 / Math.sqrt(1 + tangent * tangent);
        const sine = tangent * cosine;
        for (let index = 0; index < size; index += 1) {
          if (index === p || index === q) continue;
          const valueP = matrix[index * size + p] ?? 0;
          const valueQ = matrix[index * size + q] ?? 0;
          const nextP = cosine * valueP - sine * valueQ;
          const nextQ = sine * valueP + cosine * valueQ;
          matrix[index * size + p] = nextP;
          matrix[p * size + index] = nextP;
          matrix[index * size + q] = nextQ;
          matrix[q * size + index] = nextQ;
        }
        matrix[p * size + p] = cosine * cosine * diagonalP -
          2 * sine * cosine * offDiagonal + sine * sine * diagonalQ;
        matrix[q * size + q] = sine * sine * diagonalP +
          2 * sine * cosine * offDiagonal + cosine * cosine * diagonalQ;
        matrix[p * size + q] = 0;
        matrix[q * size + p] = 0;
        for (let index = 0; index < size; index += 1) {
          const valueP = vectors[index * size + p] ?? 0;
          const valueQ = vectors[index * size + q] ?? 0;
          vectors[index * size + p] = cosine * valueP - sine * valueQ;
          vectors[index * size + q] = sine * valueP + cosine * valueQ;
        }
      }
    }
    if (maximum < 1e-11) break;
  }
  return {
    values: Array.from({ length: size }, (_, index) => matrix[index * size + index] ?? 0),
    vectors,
  };
}

function smallestEigenvector(matrix: number[], size: number): number[] {
  const eigen = jacobiEigenSymmetric(matrix, size);
  let selected = 0;
  for (let index = 1; index < size; index += 1) {
    if ((eigen.values[index] ?? 0) < (eigen.values[selected] ?? 0)) selected = index;
  }
  const vector = Array.from(
    { length: size },
    (_, row) => eigen.vectors[row * size + selected] ?? 0,
  );
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function transpose3(matrix: number[]): number[] {
  return [
    matrix[0] ?? 0, matrix[3] ?? 0, matrix[6] ?? 0,
    matrix[1] ?? 0, matrix[4] ?? 0, matrix[7] ?? 0,
    matrix[2] ?? 0, matrix[5] ?? 0, matrix[8] ?? 0,
  ];
}

function multiply3(left: number[], right: number[]): number[] {
  const output = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        output[row * 3 + column] = (output[row * 3 + column] ?? 0) +
          (left[row * 3 + inner] ?? 0) * (right[inner * 3 + column] ?? 0);
      }
    }
  }
  return output;
}

function determinant3(matrix: number[]): number {
  return (matrix[0] ?? 0) * ((matrix[4] ?? 0) * (matrix[8] ?? 0) -
    (matrix[5] ?? 0) * (matrix[7] ?? 0)) -
    (matrix[1] ?? 0) * ((matrix[3] ?? 0) * (matrix[8] ?? 0) -
      (matrix[5] ?? 0) * (matrix[6] ?? 0)) +
    (matrix[2] ?? 0) * ((matrix[3] ?? 0) * (matrix[7] ?? 0) -
      (matrix[4] ?? 0) * (matrix[6] ?? 0));
}

function dot(left: number[], right: number[]): number {
  let output = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    output += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return output;
}

function normalize3(vector: number[]): [number, number, number] {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0) || 1;
  return [
    (vector[0] ?? 0) / length,
    (vector[1] ?? 0) / length,
    (vector[2] ?? 0) / length,
  ];
}

function cross(left: number[], right: number[]): [number, number, number] {
  return [
    (left[1] ?? 0) * (right[2] ?? 0) - (left[2] ?? 0) * (right[1] ?? 0),
    (left[2] ?? 0) * (right[0] ?? 0) - (left[0] ?? 0) * (right[2] ?? 0),
    (left[0] ?? 0) * (right[1] ?? 0) - (left[1] ?? 0) * (right[0] ?? 0),
  ];
}

function column(matrix: number[], index: number): [number, number, number] {
  return [matrix[index] ?? 0, matrix[3 + index] ?? 0, matrix[6 + index] ?? 0];
}

function fromColumns(first: number[], second: number[], third: number[]): number[] {
  return [
    first[0] ?? 0, second[0] ?? 0, third[0] ?? 0,
    first[1] ?? 0, second[1] ?? 0, third[1] ?? 0,
    first[2] ?? 0, second[2] ?? 0, third[2] ?? 0,
  ];
}

function orthonormalize3(matrix: number[]): number[] {
  const first = normalize3(column(matrix, 0));
  const rawSecond = column(matrix, 1);
  const projection = dot(rawSecond, first);
  const second = normalize3(rawSecond.map((value, index) =>
    value - projection * (first[index] ?? 0)));
  const third = normalize3(cross(first, second));
  return fromColumns(first, second, third);
}

function singularValueDecomposition3(matrix: number[]): {
  u: number[];
  singular: number[];
  v: number[];
} {
  const transpose = transpose3(matrix);
  const normal = multiply3(transpose, matrix);
  const eigen = jacobiEigenSymmetric(normal, 3);
  const order = [0, 1, 2].sort((left, right) =>
    (eigen.values[right] ?? 0) - (eigen.values[left] ?? 0));
  const columns = order.map((index) => [
    eigen.vectors[index] ?? 0,
    eigen.vectors[3 + index] ?? 0,
    eigen.vectors[6 + index] ?? 0,
  ]) as [[number, number, number], [number, number, number], [number, number, number]];
  const v = orthonormalize3(fromColumns(columns[0], columns[1], columns[2]));
  if (determinant3(v) < 0) {
    for (let row = 0; row < 3; row += 1) v[row * 3 + 2] = -(v[row * 3 + 2] ?? 0);
  }
  const singular = order.map((index) => Math.sqrt(Math.max(0, eigen.values[index] ?? 0)));
  const uColumns: [number, number, number][] = [];
  for (let columnIndex = 0; columnIndex < 2; columnIndex += 1) {
    const vector = column(v, columnIndex);
    const transformed: [number, number, number] = [
      (matrix[0] ?? 0) * vector[0] + (matrix[1] ?? 0) * vector[1] + (matrix[2] ?? 0) * vector[2],
      (matrix[3] ?? 0) * vector[0] + (matrix[4] ?? 0) * vector[1] + (matrix[5] ?? 0) * vector[2],
      (matrix[6] ?? 0) * vector[0] + (matrix[7] ?? 0) * vector[1] + (matrix[8] ?? 0) * vector[2],
    ];
    uColumns.push(normalize3(transformed.map((value) =>
      value / Math.max(singular[columnIndex] ?? 0, EPSILON))));
  }
  const first = uColumns[0] ?? [1, 0, 0];
  const rawSecond = uColumns[1] ?? [0, 1, 0];
  const projection = dot(rawSecond, first);
  const second = normalize3(rawSecond.map((value, index) =>
    value - projection * (first[index] ?? 0)));
  const third = normalize3(cross(first, second));
  const u = fromColumns(first, second, third);
  if (determinant3(u) < 0) {
    for (let row = 0; row < 3; row += 1) u[row * 3 + 2] = -(u[row * 3 + 2] ?? 0);
  }
  return { u, singular, v };
}

function enforceEssentialConstraint(matrix: number[]): number[] {
  const decomposition = singularValueDecomposition3(matrix);
  const shared = ((decomposition.singular[0] ?? 0) + (decomposition.singular[1] ?? 0)) / 2;
  return multiply3(
    multiply3(decomposition.u, [shared, 0, 0, 0, shared, 0, 0, 0, 0]),
    transpose3(decomposition.v),
  );
}

function estimateEssential(matches: NormalizedMatch[]): number[] {
  const normal = new Array<number>(81).fill(0);
  for (const match of matches) {
    const row = [
      match.x2 * match.x1, match.x2 * match.y1, match.x2,
      match.y2 * match.x1, match.y2 * match.y1, match.y2,
      match.x1, match.y1, 1,
    ];
    for (let left = 0; left < 9; left += 1) {
      for (let right = left; right < 9; right += 1) {
        const value = (normal[left * 9 + right] ?? 0) +
          (row[left] ?? 0) * (row[right] ?? 0);
        normal[left * 9 + right] = value;
        normal[right * 9 + left] = value;
      }
    }
  }
  return enforceEssentialConstraint(smallestEigenvector(normal, 9));
}

function sampsonError(matrix: number[], match: NormalizedMatch): number {
  const first = [match.x1, match.y1, 1];
  const second = [match.x2, match.y2, 1];
  const essentialFirst = [
    (matrix[0] ?? 0) * first[0]! + (matrix[1] ?? 0) * first[1]! + (matrix[2] ?? 0),
    (matrix[3] ?? 0) * first[0]! + (matrix[4] ?? 0) * first[1]! + (matrix[5] ?? 0),
    (matrix[6] ?? 0) * first[0]! + (matrix[7] ?? 0) * first[1]! + (matrix[8] ?? 0),
  ];
  const transpose = transpose3(matrix);
  const transposeSecond = [
    (transpose[0] ?? 0) * second[0]! + (transpose[1] ?? 0) * second[1]! + (transpose[2] ?? 0),
    (transpose[3] ?? 0) * second[0]! + (transpose[4] ?? 0) * second[1]! + (transpose[5] ?? 0),
    (transpose[6] ?? 0) * second[0]! + (transpose[7] ?? 0) * second[1]! + (transpose[8] ?? 0),
  ];
  const numerator = second[0]! * essentialFirst[0]! + second[1]! * essentialFirst[1]! +
    essentialFirst[2]!;
  return numerator * numerator / Math.max(
    EPSILON,
    essentialFirst[0]! ** 2 + essentialFirst[1]! ** 2 +
      transposeSecond[0]! ** 2 + transposeSecond[1]! ** 2,
  );
}

function deterministicSample(count: number, seed: number, size = 8): number[] {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(size) ||
      count <= 0 || size <= 0 || size > count) return [];
  const output: number[] = [];
  let state = seed >>> 0;
  while (output.length < size) {
    state = (1664525 * state + 1013904223) >>> 0;
    const candidate = state % count;
    if (!output.includes(candidate)) output.push(candidate);
  }
  return output;
}

function estimateEssentialRansac(matches: NormalizedMatch[], focalLength: number): EssentialEstimate | null {
  if (matches.length < 8) return null;
  let bestInliers: NormalizedMatch[] = [];
  const threshold = (2.25 / focalLength) ** 2;
  for (let iteration = 0; iteration < 180; iteration += 1) {
    const indices = deterministicSample(matches.length, iteration * 2654435761 + 17);
    const sample = indices.map((index) => matches[index]!).filter(Boolean);
    if (sample.length !== 8) continue;
    const matrix = estimateEssential(sample);
    const inliers = matches.filter((match) => sampsonError(matrix, match) < threshold);
    if (inliers.length > bestInliers.length) bestInliers = inliers;
  }
  if (bestInliers.length < 8) return null;
  return { matrix: estimateEssential(bestInliers), inliers: bestInliers };
}

function estimateCalibratedHomography(matches: NormalizedMatch[]): number[] {
  const normal = new Array<number>(81).fill(0);
  for (const match of matches) {
    const rows = [
      [-match.x1, -match.y1, -1, 0, 0, 0,
        match.x2 * match.x1, match.x2 * match.y1, match.x2],
      [0, 0, 0, -match.x1, -match.y1, -1,
        match.y2 * match.x1, match.y2 * match.y1, match.y2],
    ];
    for (const row of rows) {
      for (let left = 0; left < 9; left += 1) {
        for (let right = left; right < 9; right += 1) {
          const value = (normal[left * 9 + right] ?? 0) +
            (row[left] ?? 0) * (row[right] ?? 0);
          normal[left * 9 + right] = value;
          normal[right * 9 + left] = value;
        }
      }
    }
  }
  return smallestEigenvector(normal, 9);
}

function homographyResidualPixels(
  homography: number[],
  match: NormalizedMatch,
  focalLength: number,
): number {
  const weight = (homography[6] ?? 0) * match.x1 +
    (homography[7] ?? 0) * match.y1 + (homography[8] ?? 0);
  if (Math.abs(weight) <= EPSILON) return Number.POSITIVE_INFINITY;
  const x = ((homography[0] ?? 0) * match.x1 +
    (homography[1] ?? 0) * match.y1 + (homography[2] ?? 0)) / weight;
  const y = ((homography[3] ?? 0) * match.x1 +
    (homography[4] ?? 0) * match.y1 + (homography[5] ?? 0)) / weight;
  return focalLength * Math.hypot(x - match.x2, y - match.y2);
}

function rotationOrthogonalityError(homography: number[]): number {
  const determinant = determinant3(homography);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
    return Number.POSITIVE_INFINITY;
  }
  const sign = determinant < 0 ? -1 : 1;
  const scale = Math.cbrt(Math.abs(determinant));
  const normalized = homography.map((value) => value * sign / scale);
  const gram = multiply3(transpose3(normalized), normalized);
  let squaredError = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let columnIndex = 0; columnIndex < 3; columnIndex += 1) {
      const expected = row === columnIndex ? 1 : 0;
      squaredError += ((gram[row * 3 + columnIndex] ?? 0) - expected) ** 2;
    }
  }
  return Math.sqrt(squaredError / 9);
}

function rotationOnlyMetrics(
  matches: NormalizedMatch[],
  focalLength: number,
): { errorPixels: number; inliers: number; inlierRatio: number; orthogonalityError: number } {
  let bestInliers: NormalizedMatch[] = [];
  for (let iteration = 0; iteration < 160; iteration += 1) {
    const indices = deterministicSample(matches.length, iteration * 2246822519 + 31, 4);
    const sample = indices.map((index) => matches[index]!).filter(Boolean);
    if (sample.length !== 4) continue;
    const homography = estimateCalibratedHomography(sample);
    const inliers = matches.filter((match) =>
      homographyResidualPixels(homography, match, focalLength) <= ROTATION_ONLY_INLIER_PIXELS);
    if (inliers.length > bestInliers.length) bestInliers = inliers;
  }
  if (bestInliers.length < 4) {
    return {
      errorPixels: Number.POSITIVE_INFINITY,
      inliers: 0,
      inlierRatio: 0,
      orthogonalityError: Number.POSITIVE_INFINITY,
    };
  }
  const homography = estimateCalibratedHomography(bestInliers);
  const residuals = bestInliers.map((match) =>
    homographyResidualPixels(homography, match, focalLength));
  return {
    errorPixels: median(residuals),
    inliers: bestInliers.length,
    inlierRatio: bestInliers.length / Math.max(1, matches.length),
    orthogonalityError: rotationOrthogonalityError(homography),
  };
}

function validRotation(matrix: number[]): number[] {
  return determinant3(matrix) < 0 ? matrix.map((value) => -value) : matrix;
}

function decomposeEssential(matrix: number[]): PoseCandidate[] {
  const decomposition = singularValueDecomposition3(matrix);
  const transposeV = transpose3(decomposition.v);
  const w = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const rotation1 = validRotation(multiply3(multiply3(decomposition.u, w), transposeV));
  const rotation2 = validRotation(multiply3(
    multiply3(decomposition.u, transpose3(w)), transposeV,
  ));
  const translation = column(decomposition.u, 2);
  return [
    { rotation: rotation1, translation },
    { rotation: rotation1, translation: translation.map((value) => -value) },
    { rotation: rotation2, translation },
    { rotation: rotation2, translation: translation.map((value) => -value) },
  ];
}

function transformPoint(rotation: number[], translation: number[], point: number[]): [number, number, number] {
  return [
    (rotation[0] ?? 0) * (point[0] ?? 0) + (rotation[1] ?? 0) * (point[1] ?? 0) +
      (rotation[2] ?? 0) * (point[2] ?? 0) + (translation[0] ?? 0),
    (rotation[3] ?? 0) * (point[0] ?? 0) + (rotation[4] ?? 0) * (point[1] ?? 0) +
      (rotation[5] ?? 0) * (point[2] ?? 0) + (translation[1] ?? 0),
    (rotation[6] ?? 0) * (point[0] ?? 0) + (rotation[7] ?? 0) * (point[1] ?? 0) +
      (rotation[8] ?? 0) * (point[2] ?? 0) + (translation[2] ?? 0),
  ];
}

function triangulationAngle(match: NormalizedMatch, rotation: number[]): number {
  const firstRay = normalize3([match.x1, match.y1, 1]);
  const secondRayCamera2 = normalize3([match.x2, match.y2, 1]);
  const secondRay = normalize3([
    (rotation[0] ?? 0) * secondRayCamera2[0] + (rotation[3] ?? 0) * secondRayCamera2[1] +
      (rotation[6] ?? 0) * secondRayCamera2[2],
    (rotation[1] ?? 0) * secondRayCamera2[0] + (rotation[4] ?? 0) * secondRayCamera2[1] +
      (rotation[7] ?? 0) * secondRayCamera2[2],
    (rotation[2] ?? 0) * secondRayCamera2[0] + (rotation[5] ?? 0) * secondRayCamera2[1] +
      (rotation[8] ?? 0) * secondRayCamera2[2],
  ]);
  return Math.acos(clamp(dot(firstRay, secondRay), -1, 1)) * 180 / Math.PI;
}

function triangulate(
  match: NormalizedMatch,
  rotation: number[],
  translation: number[],
  focalLength: number,
): TriangulatedPoint | null {
  const projection2 = [
    rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, translation[0] ?? 0,
    rotation[3] ?? 0, rotation[4] ?? 0, rotation[5] ?? 0, translation[1] ?? 0,
    rotation[6] ?? 0, rotation[7] ?? 0, rotation[8] ?? 0, translation[2] ?? 0,
  ];
  const rows = [
    [-1, 0, match.x1, 0],
    [0, -1, match.y1, 0],
    [
      match.x2 * projection2[8]! - projection2[0]!,
      match.x2 * projection2[9]! - projection2[1]!,
      match.x2 * projection2[10]! - projection2[2]!,
      match.x2 * projection2[11]! - projection2[3]!,
    ],
    [
      match.y2 * projection2[8]! - projection2[4]!,
      match.y2 * projection2[9]! - projection2[5]!,
      match.y2 * projection2[10]! - projection2[6]!,
      match.y2 * projection2[11]! - projection2[7]!,
    ],
  ];
  const normal = new Array<number>(16).fill(0);
  for (const row of rows) {
    for (let left = 0; left < 4; left += 1) {
      for (let right = 0; right < 4; right += 1) {
        normal[left * 4 + right] = (normal[left * 4 + right] ?? 0) +
          (row[left] ?? 0) * (row[right] ?? 0);
      }
    }
  }
  const homogeneous = smallestEigenvector(normal, 4);
  const weight = homogeneous[3] ?? 0;
  if (Math.abs(weight) < 1e-8) return null;
  const position: [number, number, number] = [
    (homogeneous[0] ?? 0) / weight,
    (homogeneous[1] ?? 0) / weight,
    (homogeneous[2] ?? 0) / weight,
  ];
  const second = transformPoint(rotation, translation, position);
  if (Math.abs(position[2]) < EPSILON || Math.abs(second[2]) < EPSILON) return null;
  const firstProjection: [number, number] = [position[0] / position[2], position[1] / position[2]];
  const secondProjection: [number, number] = [second[0] / second[2], second[1] / second[2]];
  const errorPixels = focalLength * (
    Math.hypot(firstProjection[0] - match.x1, firstProjection[1] - match.y1) +
    Math.hypot(secondProjection[0] - match.x2, secondProjection[1] - match.y2)
  ) / 2;
  return {
    position,
    depth1: position[2],
    depth2: second[2],
    errorPixels,
    angleDegrees: triangulationAngle(match, rotation),
    match,
  };
}

function detectFeatures(frame: ScanFramePayload, maximum = 420): Feature[] {
  const candidates: Feature[] = [];
  const { width, height, luma } = frame;
  for (let y = 6; y < height - 6; y += 3) {
    for (let x = 6; x < width - 6; x += 3) {
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const index = (y + offsetY) * width + x + offsetX;
          const gradientX = (luma[index + 1] ?? 0) - (luma[index - 1] ?? 0);
          const gradientY = (luma[index + width] ?? 0) - (luma[index - width] ?? 0);
          xx += gradientX * gradientX;
          yy += gradientY * gradientY;
          xy += gradientX * gradientY;
        }
      }
      const trace = xx + yy;
      const score = xx * yy - xy * xy - 0.045 * trace * trace;
      if (score > 0.00018) candidates.push({ x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: Feature[] = [];
  for (const candidate of candidates) {
    if (selected.every((feature) => {
      const deltaX = feature.x - candidate.x;
      const deltaY = feature.y - candidate.y;
      return deltaX * deltaX + deltaY * deltaY > 64;
    })) selected.push(candidate);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function patchError(
  first: ScanFramePayload,
  second: ScanFramePayload,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let meanFirst = 0;
  let meanSecond = 0;
  let samples = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      meanFirst += first.luma[(ay + offsetY) * first.width + ax + offsetX] ?? 0;
      meanSecond += second.luma[(by + offsetY) * second.width + bx + offsetX] ?? 0;
      samples += 1;
    }
  }
  meanFirst /= samples;
  meanSecond /= samples;
  let error = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const left = (first.luma[(ay + offsetY) * first.width + ax + offsetX] ?? 0) - meanFirst;
      const right = (second.luma[(by + offsetY) * second.width + bx + offsetX] ?? 0) - meanSecond;
      error += Math.abs(left - right);
    }
  }
  return error / samples;
}

function bestPatchMatch(
  first: ScanFramePayload,
  second: ScanFramePayload,
  sourceX: number,
  sourceY: number,
  centerX: number,
  centerY: number,
  radius: number,
  step: number,
): { x: number; y: number; best: number; second: number } | null {
  let best = Number.POSITIVE_INFINITY;
  let secondBest = Number.POSITIVE_INFINITY;
  let bestX = centerX;
  let bestY = centerY;
  for (let offsetY = -radius; offsetY <= radius; offsetY += step) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += step) {
      const x = Math.round(centerX + offsetX);
      const y = Math.round(centerY + offsetY);
      if (x < 3 || y < 3 || x >= second.width - 3 || y >= second.height - 3) continue;
      const error = patchError(first, second, sourceX, sourceY, x, y);
      if (error < best) {
        secondBest = best;
        best = error;
        bestX = x;
        bestY = y;
      } else if (error < secondBest) {
        secondBest = error;
      }
    }
  }
  if (!Number.isFinite(best)) return null;
  return { x: bestX, y: bestY, best, second: secondBest };
}

function matchFrames(first: ScanFramePayload, second: ScanFramePayload): PixelMatch[] {
  const output: PixelMatch[] = [];
  for (const feature of detectFeatures(first)) {
    const coarse = bestPatchMatch(first, second, feature.x, feature.y, feature.x, feature.y, 36, 3);
    if (!coarse) continue;
    const refined = bestPatchMatch(first, second, feature.x, feature.y, coarse.x, coarse.y, 3, 1);
    if (!refined || refined.best > 0.15 || refined.best > refined.second * 0.93) continue;
    const reverse = bestPatchMatch(second, first, refined.x, refined.y, feature.x, feature.y, 5, 1);
    if (!reverse || Math.hypot(reverse.x - feature.x, reverse.y - feature.y) > 2.5) continue;
    output.push({
      ax: feature.x,
      ay: feature.y,
      bx: refined.x,
      by: refined.y,
      error: refined.best,
      residual: 0,
    });
  }
  return output;
}

function spatialCoverage(matches: PixelMatch[], width: number, height: number): number {
  const occupied = new Set<string>();
  for (const match of matches) {
    const column = Math.min(5, Math.max(0, Math.floor(match.ax / Math.max(1, width) * 6)));
    const row = Math.min(3, Math.max(0, Math.floor(match.ay / Math.max(1, height) * 4)));
    occupied.add(`${column}:${row}`);
  }
  return occupied.size / 24;
}

function candidatePairs(frames: ScanFramePayload[]): [number, number][] {
  const candidates = new Map<string, [number, number]>();
  const add = (first: number, second: number): void => {
    if (first < 0 || second >= frames.length || first >= second) return;
    candidates.set(`${first}:${second}`, [first, second]);
  };
  for (let gap = 1; gap <= 3; gap += 1) {
    for (let first = 0; first + gap < frames.length; first += 1) {
      add(first, first + gap);
    }
  }
  const last = frames.length - 1;
  const middle = Math.floor(last / 2);
  const lowerThird = Math.floor(last / 3);
  const upperThird = Math.ceil(last * 2 / 3);
  add(0, last);
  add(0, last - 1);
  add(1, last);
  add(0, middle);
  add(middle, last);
  add(1, last - 1);
  add(0, upperThird);
  add(lowerThird, last);
  add(lowerThird, upperThird);
  return [...candidates.values()];
}

function choosePairs(frames: ScanFramePayload[]): PairSelection[] {
  const selections: PairSelection[] = [];
  for (const pair of candidatePairs(frames)) {
    const first = frames[pair[0]];
    const second = frames[pair[1]];
    if (!first || !second || first.width !== second.width || first.height !== second.height) continue;
    const matches = matchFrames(first, second);
    const flow = median(matches.map((match) => Math.hypot(match.bx - match.ax, match.by - match.ay)));
    const coverage = spatialCoverage(matches, first.width, first.height);
    const usableFlow = Number.isFinite(flow) ? Math.min(flow, 24) : 0;
    const score = matches.length * coverage * usableFlow;
    selections.push({ pair, matches, coverage, medianFlow: flow, score });
  }
  return selections.sort((left, right) => right.score - left.score);
}

function sampleColor(frame: ScanFramePayload, x: number, y: number): [number, number, number] {
  const safeX = Math.round(clamp(x, 0, frame.width - 1));
  const safeY = Math.round(clamp(y, 0, frame.height - 1));
  const offset = (safeY * frame.width + safeX) * 4;
  return [
    (frame.rgba[offset] ?? 0) / 255,
    (frame.rgba[offset + 1] ?? 0) / 255,
    (frame.rgba[offset + 2] ?? 0) / 255,
  ];
}

function normalizePointCloud(points: RelativePoint[]): RelativePoint[] {
  if (points.length === 0) return [];
  const centerX = median(points.map((point) => point.x));
  const centerY = median(points.map((point) => point.y));
  const centerZ = median(points.map((point) => point.z));
  const radii = points.map((point) => Math.hypot(
    point.x - centerX,
    point.y - centerY,
    point.z - centerZ,
  ));
  const radius = Math.max(1e-5, median(radii));
  return points
    .filter((_, index) => (radii[index] ?? Number.POSITIVE_INFINITY) <= radius * 4.5)
    .slice(0, MAX_OUTPUT_POINTS)
    .map((point) => ({
      ...point,
      x: (point.x - centerX) / radius,
      y: (point.y - centerY) / radius,
      z: (point.z - centerZ) / radius,
    }));
}

function solvePair(
  frames: ScanFramePayload[],
  selected: PairSelection,
  startedAt: number,
): SolveSuccess | SolveFailure {
  const fail = (reason: string, metrics: Partial<SolveMetrics> = {}): SolveFailure => ({
    type: "result",
    ok: false,
    reason,
    metrics: {
      keyframes: frames.length,
      ...metrics,
      processingMs: performance.now() - startedAt,
    },
  });
  const first = frames[selected.pair[0]]!;
  const focalLength = Math.max(first.width, first.height) * 0.9;
  const centerX = first.width / 2;
  const centerY = first.height / 2;
  if (selected.matches.length < MIN_MATCHES) {
    return fail("Not enough stable correspondences survived matching.", {
      pair: selected.pair,
      matches: selected.matches.length,
      coverage: selected.coverage,
    });
  }
  if (!Number.isFinite(selected.medianFlow) || selected.medianFlow < 1.2) {
    return fail("The views contain too little camera translation for triangulation.", {
      pair: selected.pair,
      matches: selected.matches.length,
      coverage: selected.coverage,
    });
  }
  const normalized: NormalizedMatch[] = selected.matches.map((match) => ({
    ...match,
    x1: (match.ax - centerX) / focalLength,
    y1: (match.ay - centerY) / focalLength,
    x2: (match.bx - centerX) / focalLength,
    y2: (match.by - centerY) / focalLength,
  }));
  const essential = estimateEssentialRansac(normalized, focalLength);
  if (!essential || essential.inliers.length < MIN_MATCHES) {
    return fail("The correspondence geometry did not produce a stable essential matrix.", {
      pair: selected.pair,
      matches: selected.matches.length,
      inliers: essential?.inliers.length ?? 0,
      coverage: selected.coverage,
    });
  }
  const rotationOnly = rotationOnlyMetrics(essential.inliers, focalLength);
  const modelMetrics: Partial<SolveMetrics> = {
    pair: selected.pair,
    matches: selected.matches.length,
    inliers: essential.inliers.length,
    coverage: selected.coverage,
    rotationOnlyErrorPixels: rotationOnly.errorPixels,
    rotationOnlyInlierRatio: rotationOnly.inlierRatio,
  };
  if (rotationOnly.errorPixels <= ROTATION_ONLY_MAX_MEDIAN_ERROR_PIXELS &&
      rotationOnly.inliers >= ROTATION_ONLY_MIN_INLIERS &&
      rotationOnly.inlierRatio >= ROTATION_ONLY_MIN_INLIER_RATIO &&
      rotationOnly.orthogonalityError <= ROTATION_ONLY_MAX_ORTHOGONALITY_ERROR) {
    return fail(
      "The views are explained by camera rotation without observable translation.",
      modelMetrics,
    );
  }
  let best: {
    candidate: PoseCandidate;
    points: TriangulatedPoint[];
    positive: number;
    medianError: number;
    score: number;
  } | null = null;
  for (const candidate of decomposeEssential(essential.matrix)) {
    const points = essential.inliers.map((match) => triangulate(
      match,
      candidate.rotation,
      candidate.translation,
      focalLength,
    )).filter((point): point is TriangulatedPoint => point !== null);
    const positive = points.filter((point) => point.depth1 > 0 && point.depth2 > 0).length;
    const medianError = median(points.map((point) => point.errorPixels));
    const score = positive * 1000 - medianError;
    if (!best || score > best.score) best = { candidate, points, positive, medianError, score };
  }
  if (!best) return fail("Camera pose recovery failed.");
  const valid = best.points.filter((point) =>
    point.depth1 > 0 && point.depth2 > 0 && point.errorPixels <= 3.5 &&
    point.angleDegrees >= 0.2 && point.angleDegrees <= 45);
  const positiveDepthRatio = best.positive / Math.max(1, best.points.length);
  const reprojectionErrorPixels = median(valid.map((point) => point.errorPixels));
  const triangulationAngleDegrees = median(valid.map((point) => point.angleDegrees));
  const parallaxDegrees = Math.atan2(selected.medianFlow, focalLength) * 180 / Math.PI;
  const partialMetrics: Partial<SolveMetrics> = {
    pair: selected.pair,
    matches: selected.matches.length,
    inliers: essential.inliers.length,
    reconstructed: valid.length,
    positiveDepthRatio,
    reprojectionErrorPixels,
    parallaxDegrees,
    coverage: selected.coverage,
    triangulationAngleDegrees,
    rotationOnlyErrorPixels: rotationOnly.errorPixels,
    rotationOnlyInlierRatio: rotationOnly.inlierRatio,
  };
  if (valid.length < MIN_RECONSTRUCTED_POINTS) {
    return fail("Too few points passed positive-depth and reprojection checks.", partialMetrics);
  }
  if (positiveDepthRatio < 0.5 || reprojectionErrorPixels > 3.5 ||
      triangulationAngleDegrees < 0.35 || selected.coverage < 0.24) {
    return fail("The scan did not meet the geometric acceptance thresholds.", partialMetrics);
  }
  const points = normalizePointCloud(valid.map((point) => {
    const color = sampleColor(first, point.match.ax, point.match.ay);
    return {
      x: point.position[0],
      y: -point.position[1],
      z: point.position[2],
      r: color[0],
      g: color[1],
      b: color[2],
      error: point.errorPixels,
    };
  }));
  if (points.length < MIN_RECONSTRUCTED_POINTS) {
    return fail("The accepted geometry was too spatially unstable after outlier trimming.", partialMetrics);
  }
  return {
    type: "result",
    ok: true,
    points,
    metrics: {
      keyframes: frames.length,
      pair: selected.pair,
      matches: selected.matches.length,
      inliers: essential.inliers.length,
      reconstructed: points.length,
      positiveDepthRatio,
      reprojectionErrorPixels,
      parallaxDegrees,
      coverage: selected.coverage,
      triangulationAngleDegrees,
      rotationOnlyErrorPixels: rotationOnly.errorPixels,
      rotationOnlyInlierRatio: rotationOnly.inlierRatio,
      processingMs: performance.now() - startedAt,
    },
  };
}

function failureProgress(result: SolveFailure): number {
  return Number(result.metrics.reconstructed ?? 0) * 1_000_000 +
    Number(result.metrics.inliers ?? 0) * 1_000 +
    Number(result.metrics.matches ?? 0);
}

function solve(frames: ScanFramePayload[]): SolveSuccess | SolveFailure {
  const startedAt = performance.now();
  const fail = (reason: string): SolveFailure => ({
    type: "result",
    ok: false,
    reason,
    metrics: { keyframes: frames.length, processingMs: performance.now() - startedAt },
  });
  if (frames.length < 6) return fail("At least six distinct views are required.");
  const selections = choosePairs(frames);
  if (selections.length === 0) return fail("No usable keyframe pair was found.");
  let bestFailure: SolveFailure | null = null;
  for (let index = 0; index < selections.length; index += 1) {
    const selected = selections[index]!;
    const result = solvePair(frames, selected, startedAt);
    result.metrics.keyframes = frames.length;
    if (result.ok) return result;
    if (!bestFailure || failureProgress(result) > failureProgress(bestFailure)) {
      bestFailure = result;
    }
  }
  if (!bestFailure) return fail("No candidate baseline produced measurable geometry.");
  return {
    ...bestFailure,
    metrics: {
      ...bestFailure.metrics,
      keyframes: frames.length,
      processingMs: performance.now() - startedAt,
    },
  };
}

scope.onmessage = (event): void => {
  if (event.data.type !== "solve") return;
  try {
    scope.postMessage(solve(event.data.frames));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    scope.postMessage({
      type: "result",
      ok: false,
      reason: `The scan worker failed: ${detail}`,
      metrics: { keyframes: event.data.frames.length, processingMs: 0 },
    });
  }
};
