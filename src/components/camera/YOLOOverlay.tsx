'use client';

import { useEffect, useRef } from 'react';
import { RoboflowDetection } from '@/lib/roboflow';
import { ROBOFLOW_HIGH_CONFIDENCE, ROBOFLOW_CONFIDENCE_THRESHOLD } from '@/config/constants';

interface YOLOOverlayProps {
  detections: RoboflowDetection[];
  videoWidth: number;
  videoHeight: number;
  className?: string;
  visible?: boolean;
  mirrored?: boolean;
}

// Color based on confidence level
function getBoxColor(confidence: number): string {
  if (confidence >= ROBOFLOW_HIGH_CONFIDENCE) {
    return '#22c55e'; // green-500 - high confidence
  } else if (confidence >= ROBOFLOW_CONFIDENCE_THRESHOLD) {
    return '#facc15'; // yellow-400 - medium confidence
  }
  return '#f87171'; // red-400 - low confidence
}

function getLabelBackground(confidence: number): string {
  if (confidence >= ROBOFLOW_HIGH_CONFIDENCE) {
    return 'rgba(34, 197, 94, 0.9)'; // green with opacity
  } else if (confidence >= ROBOFLOW_CONFIDENCE_THRESHOLD) {
    return 'rgba(250, 204, 21, 0.9)'; // yellow with opacity
  }
  return 'rgba(248, 113, 113, 0.9)'; // red with opacity
}

export function YOLOOverlay({
  detections,
  videoWidth,
  videoHeight,
  className = '',
  visible = true,
  mirrored = true,
}: YOLOOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !visible) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match video
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    // Clear previous frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each detection bounding box
    for (const detection of detections) {
      const { bbox, class: signClass, confidence } = detection;

      // Convert normalized coordinates to pixel values
      let x = bbox.x * videoWidth;
      const y = bbox.y * videoHeight;
      const width = bbox.width * videoWidth;
      const height = bbox.height * videoHeight;

      // Mirror x coordinate if needed (video is mirrored)
      if (mirrored) {
        x = videoWidth - x - width;
      }

      const boxColor = getBoxColor(confidence);
      const labelBg = getLabelBackground(confidence);

      // Draw bounding box
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      // Prepare label text
      const confidencePercent = Math.round(confidence * 100);
      const label = `${signClass} ${confidencePercent}%`;

      // Measure label dimensions
      ctx.font = 'bold 14px system-ui, sans-serif';
      const textMetrics = ctx.measureText(label);
      const labelHeight = 22;
      const labelPadding = 6;
      const labelWidth = textMetrics.width + labelPadding * 2;

      // Position label above box (or below if at top edge)
      let labelY = y - labelHeight - 4;
      if (labelY < 0) {
        labelY = y + height + 4;
      }

      // Draw label background
      ctx.fillStyle = labelBg;
      ctx.fillRect(x, labelY, labelWidth, labelHeight);

      // Draw label text
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + labelPadding, labelY + labelHeight / 2);
    }
  }, [detections, videoWidth, videoHeight, visible, mirrored]);

  if (!visible || detections.length === 0) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
      aria-hidden="true"
    />
  );
}

// Expose toggle function for browser console testing
if (typeof window !== 'undefined') {
  let overlayVisible = true;
  (window as unknown as { toggleYOLOOverlay: (visible?: boolean) => boolean }).toggleYOLOOverlay = (visible?: boolean) => {
    overlayVisible = visible ?? !overlayVisible;
    console.log(`YOLO overlay ${overlayVisible ? 'visible' : 'hidden'}`);
    return overlayVisible;
  };
}

export default YOLOOverlay;
