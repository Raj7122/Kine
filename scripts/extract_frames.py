#!/usr/bin/env python3
"""
Extract frames from How2Sign ASL videos at 24fps as WebP images.

Usage:
    python extract_frames.py --input /path/to/how2sign/videos --output ./frames
    python extract_frames.py --input video.mp4 --output ./frames --gloss HELLO

Requirements:
    pip install -r requirements.txt
    FFmpeg must be installed: brew install ffmpeg
"""

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path
from typing import Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import cv2
    from PIL import Image
    from tqdm import tqdm
except ImportError:
    print("Missing dependencies. Run: pip install -r requirements.txt")
    sys.exit(1)


# Configuration
TARGET_FPS = 24
WEBP_QUALITY = 80  # 0-100, higher = better quality, larger files
MAX_DIMENSION = 512  # Max width/height for frames
FRAME_FORMAT = "{:04d}.webp"  # 0001.webp, 0002.webp, etc.


def extract_with_ffmpeg(
    video_path: str,
    output_dir: str,
    fps: int = TARGET_FPS,
    quality: int = WEBP_QUALITY,
    max_dim: int = MAX_DIMENSION
) -> int:
    """
    Extract frames using FFmpeg (faster than OpenCV for WebP).
    Returns the number of frames extracted.
    """
    os.makedirs(output_dir, exist_ok=True)
    output_pattern = os.path.join(output_dir, FRAME_FORMAT)

    # FFmpeg command for WebP extraction with scaling
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-vf", f"fps={fps},scale='min({max_dim},iw)':min'({max_dim},ih)':force_original_aspect_ratio=decrease",
        "-c:v", "libwebp",
        "-quality", str(quality),
        "-y",  # Overwrite existing files
        output_pattern
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg error: {e.stderr}")
        return 0
    except FileNotFoundError:
        print("FFmpeg not found. Install with: brew install ffmpeg")
        return 0

    # Count extracted frames
    frames = list(Path(output_dir).glob("*.webp"))
    return len(frames)


def extract_with_opencv(
    video_path: str,
    output_dir: str,
    fps: int = TARGET_FPS,
    quality: int = WEBP_QUALITY,
    max_dim: int = MAX_DIMENSION
) -> int:
    """
    Fallback: Extract frames using OpenCV (if FFmpeg unavailable).
    Returns the number of frames extracted.
    """
    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Cannot open video {video_path}")
        return 0

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = int(video_fps / fps) if video_fps > fps else 1

    frame_count = 0
    saved_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Sample at target FPS
        if frame_count % frame_interval == 0:
            saved_count += 1

            # Resize if needed
            h, w = frame.shape[:2]
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))

            # Convert BGR to RGB and save as WebP
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(frame_rgb)

            output_path = os.path.join(output_dir, FRAME_FORMAT.format(saved_count))
            img.save(output_path, "WEBP", quality=quality)

        frame_count += 1

    cap.release()
    return saved_count


def extract_frames(
    video_path: str,
    output_dir: str,
    use_ffmpeg: bool = True
) -> int:
    """
    Extract frames from video using FFmpeg (preferred) or OpenCV (fallback).
    """
    if use_ffmpeg:
        count = extract_with_ffmpeg(video_path, output_dir)
        if count == 0:
            print("FFmpeg failed, falling back to OpenCV...")
            count = extract_with_opencv(video_path, output_dir)
    else:
        count = extract_with_opencv(video_path, output_dir)

    return count


def get_gloss_from_filename(filename: str) -> str:
    """
    Extract gloss label from How2Sign filename.
    Example: "COFFEE_001.mp4" -> "COFFEE"
    """
    name = Path(filename).stem
    # Remove numeric suffixes
    parts = name.split("_")
    gloss_parts = [p for p in parts if not p.isdigit()]
    return "_".join(gloss_parts).upper()


def process_directory(
    input_dir: str,
    output_dir: str,
    max_workers: int = 4,
    use_ffmpeg: bool = True
) -> Dict[str, int]:
    """
    Process all videos in a directory.
    Returns a dict mapping gloss labels to frame counts.
    """
    input_path = Path(input_dir)
    video_extensions = {".mp4", ".mov", ".avi", ".webm", ".mkv"}

    videos = [
        f for f in input_path.iterdir()
        if f.suffix.lower() in video_extensions
    ]

    if not videos:
        print(f"No videos found in {input_dir}")
        return {}

    results: Dict[str, int] = {}

    print(f"Processing {len(videos)} videos...")

    with tqdm(total=len(videos), desc="Extracting frames") as pbar:
        for video in videos:
            gloss = get_gloss_from_filename(video.name)
            gloss_output = os.path.join(output_dir, gloss)

            count = extract_frames(str(video), gloss_output, use_ffmpeg)
            results[gloss] = count

            pbar.update(1)
            pbar.set_postfix({"current": gloss, "frames": count})

    return results


def generate_manifest(output_dir: str, results: Dict[str, int]) -> str:
    """
    Generate manifest.json with frame counts for each gloss.
    """
    manifest = {
        "version": "1.0",
        "fps": TARGET_FPS,
        "format": "webp",
        "glosses": {
            gloss: {
                "frame_count": count,
                "duration_ms": int(count / TARGET_FPS * 1000),
                "storage_path": f"avatars/{gloss}"
            }
            for gloss, count in results.items()
            if count > 0
        }
    }

    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest_path


def main():
    parser = argparse.ArgumentParser(
        description="Extract frames from ASL videos for flipbook playback"
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Input video file or directory containing videos"
    )
    parser.add_argument(
        "--output", "-o",
        default="./frames",
        help="Output directory for extracted frames (default: ./frames)"
    )
    parser.add_argument(
        "--gloss", "-g",
        help="Gloss label for single video (optional, auto-detected from filename)"
    )
    parser.add_argument(
        "--no-ffmpeg",
        action="store_true",
        help="Use OpenCV instead of FFmpeg"
    )
    parser.add_argument(
        "--workers", "-w",
        type=int,
        default=4,
        help="Number of parallel workers (default: 4)"
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    use_ffmpeg = not args.no_ffmpeg

    if not input_path.exists():
        print(f"Error: Input path does not exist: {args.input}")
        sys.exit(1)

    if input_path.is_file():
        # Single video
        gloss = args.gloss or get_gloss_from_filename(input_path.name)
        output_dir = os.path.join(args.output, gloss)

        print(f"Extracting frames from: {input_path.name}")
        print(f"Gloss label: {gloss}")
        print(f"Output directory: {output_dir}")

        count = extract_frames(str(input_path), output_dir, use_ffmpeg)

        if count > 0:
            print(f"\nSuccess! Extracted {count} frames")
            print(f"Duration: {count / TARGET_FPS:.2f} seconds at {TARGET_FPS}fps")

            # Generate manifest for single video
            results = {gloss: count}
            manifest_path = generate_manifest(args.output, results)
            print(f"Manifest: {manifest_path}")
        else:
            print("Error: No frames extracted")
            sys.exit(1)

    else:
        # Directory of videos
        print(f"Processing videos in: {args.input}")
        print(f"Output directory: {args.output}")

        results = process_directory(
            args.input,
            args.output,
            args.workers,
            use_ffmpeg
        )

        if results:
            # Generate manifest
            manifest_path = generate_manifest(args.output, results)

            total_frames = sum(results.values())
            print(f"\nComplete!")
            print(f"Processed {len(results)} glosses")
            print(f"Total frames: {total_frames}")
            print(f"Manifest: {manifest_path}")
        else:
            print("Error: No frames extracted")
            sys.exit(1)


if __name__ == "__main__":
    main()
