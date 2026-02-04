// Roboflow API response types

export interface RoboflowResponse {
  predictions: RoboflowPrediction[];
  time: number;  // inference time in seconds
  image: { width: number; height: number };
}

export interface RoboflowPrediction {
  class: string;           // e.g., "hello", "A", "thank_you"
  confidence: number;      // 0-1
  x: number;               // center x (pixels)
  y: number;               // center y (pixels)
  width: number;           // box width (pixels)
  height: number;          // box height (pixels)
}

export interface RoboflowDetection {
  class: string;
  confidence: number;
  bbox: BoundingBox;
  timestamp: number;
}

export interface BoundingBox {
  x: number;      // normalized 0-1 (top-left x)
  y: number;      // normalized 0-1 (top-left y)
  width: number;  // normalized 0-1
  height: number; // normalized 0-1
}

export interface RoboflowError {
  message: string;
  status?: number;
  retryAfter?: number;  // seconds until rate limit resets
}

export interface RoboflowConfig {
  apiKey: string;
  modelId: string;
  version: string;
  apiUrl: string;
}
