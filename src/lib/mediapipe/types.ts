// MediaPipe landmark types for hand and face detection

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface HandLandmarkResult {
  landmarks: Landmark[][];
  worldLandmarks: Landmark[][];
  handedness: Array<{ categoryName: string; score: number }[]>;
}

export interface Category {
  categoryName: string;
  score: number;
  index?: number;
  displayName?: string;
}

export interface Classifications {
  categories: Category[];
  headIndex?: number;
  headName?: string;
}

export interface FaceLandmarkResult {
  faceLandmarks: Landmark[][];
  faceBlendshapes?: Classifications[];
}

export interface LandmarkResult {
  hands: HandLandmarkResult | null;
  face: FaceLandmarkResult | null;
  timestamp: number;
}

// Hand landmark indices for reference
export const HAND_LANDMARKS = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

// Hand skeleton connections (pairs of landmark indices to draw lines between)
export const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index finger
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle finger
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring finger
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm
  [5, 9], [9, 13], [13, 17],
];

// Key face landmarks for ASL grammar (eyebrows, mouth)
export const FACE_LANDMARKS = {
  // Eyebrows
  LEFT_EYEBROW_INNER: 107,
  LEFT_EYEBROW_OUTER: 66,
  RIGHT_EYEBROW_INNER: 336,
  RIGHT_EYEBROW_OUTER: 296,
  // Mouth
  UPPER_LIP: 13,
  LOWER_LIP: 14,
  LEFT_MOUTH_CORNER: 61,
  RIGHT_MOUTH_CORNER: 291,
} as const;
