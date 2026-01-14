import type { Landmark, HandLandmarkResult, FaceLandmarkResult } from './types';
import { HAND_CONNECTIONS, FACE_LANDMARKS } from './types';

// Colors
const HAND_COLOR = '#EF4444'; // Red for hand skeleton
const HAND_POINT_COLOR = '#FCA5A5'; // Lighter red for joints
const FACE_COLOR = '#60A5FA'; // Blue for face points (subtle)

// Sizes
const LINE_WIDTH = 3;
const POINT_RADIUS = 4;
const FACE_POINT_RADIUS = 2;

export function drawHandLandmarks(
  ctx: CanvasRenderingContext2D,
  handResult: HandLandmarkResult,
  canvasWidth: number,
  canvasHeight: number,
  isMirrored: boolean = true
): void {
  for (const landmarks of handResult.landmarks) {
    // Draw connections (skeleton lines)
    ctx.strokeStyle = HAND_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [start, end] of HAND_CONNECTIONS) {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];

      if (startPoint && endPoint) {
        ctx.beginPath();
        ctx.moveTo(
          transformX(startPoint.x, canvasWidth, isMirrored),
          startPoint.y * canvasHeight
        );
        ctx.lineTo(
          transformX(endPoint.x, canvasWidth, isMirrored),
          endPoint.y * canvasHeight
        );
        ctx.stroke();
      }
    }

    // Draw landmark points
    ctx.fillStyle = HAND_POINT_COLOR;
    for (const landmark of landmarks) {
      ctx.beginPath();
      ctx.arc(
        transformX(landmark.x, canvasWidth, isMirrored),
        landmark.y * canvasHeight,
        POINT_RADIUS,
        0,
        2 * Math.PI
      );
      ctx.fill();
    }

    // Highlight fingertips with larger circles
    const fingertips = [4, 8, 12, 16, 20];
    ctx.fillStyle = HAND_COLOR;
    for (const tipIndex of fingertips) {
      const tip = landmarks[tipIndex];
      if (tip) {
        ctx.beginPath();
        ctx.arc(
          transformX(tip.x, canvasWidth, isMirrored),
          tip.y * canvasHeight,
          POINT_RADIUS + 2,
          0,
          2 * Math.PI
        );
        ctx.fill();
      }
    }
  }
}

export function drawFaceLandmarks(
  ctx: CanvasRenderingContext2D,
  faceResult: FaceLandmarkResult,
  canvasWidth: number,
  canvasHeight: number,
  isMirrored: boolean = true,
  drawFullMesh: boolean = false
): void {
  for (const landmarks of faceResult.faceLandmarks) {
    if (drawFullMesh) {
      // Draw all face landmarks (subtle)
      ctx.fillStyle = FACE_COLOR + '40'; // 25% opacity
      for (const landmark of landmarks) {
        ctx.beginPath();
        ctx.arc(
          transformX(landmark.x, canvasWidth, isMirrored),
          landmark.y * canvasHeight,
          FACE_POINT_RADIUS,
          0,
          2 * Math.PI
        );
        ctx.fill();
      }
    }

    // Always draw key landmarks for ASL grammar (eyebrows, mouth)
    ctx.fillStyle = FACE_COLOR;
    const keyIndices = Object.values(FACE_LANDMARKS);

    for (const index of keyIndices) {
      const landmark = landmarks[index];
      if (landmark) {
        ctx.beginPath();
        ctx.arc(
          transformX(landmark.x, canvasWidth, isMirrored),
          landmark.y * canvasHeight,
          FACE_POINT_RADIUS + 1,
          0,
          2 * Math.PI
        );
        ctx.fill();
      }
    }
  }
}

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Helper to mirror X coordinate for selfie view
function transformX(x: number, width: number, isMirrored: boolean): number {
  return isMirrored ? width - x * width : x * width;
}
