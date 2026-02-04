#!/usr/bin/env python3
"""
Landmark Extraction Script
Extracts MediaPipe hand landmarks from WLASL video files.

Usage:
    python extract_landmarks.py --input ./data/wlasl --output ./data/landmarks
"""

import argparse
import json
import os
from pathlib import Path
from typing import List, Tuple, Optional
import numpy as np
import cv2
import mediapipe as mp
from tqdm import tqdm


# MediaPipe setup
mp_hands = mp.solutions.hands


def extract_landmarks_from_video(
    video_path: Path,
    target_fps: float = 30.0,
    min_detection_confidence: float = 0.5,
    min_tracking_confidence: float = 0.5,
) -> Tuple[Optional[np.ndarray], dict]:
    """
    Extract hand landmarks from a video file.

    Returns:
        landmarks: numpy array of shape (n_frames, 126)
                   126 = 21 landmarks × 3 coords × 2 hands
        metadata: dict with video info
    """
    cap = cv2.VideoCapture(str(video_path))

    if not cap.isOpened():
        return None, {'error': f'Could not open video: {video_path}'}

    # Get video properties
    original_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if original_fps <= 0 or total_frames <= 0:
        cap.release()
        return None, {'error': 'Invalid video properties'}

    # Calculate frame sampling
    frame_interval = max(1, int(original_fps / target_fps))

    landmarks_list = []
    hand_presence_list = []

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        min_detection_confidence=min_detection_confidence,
        min_tracking_confidence=min_tracking_confidence,
    ) as hands:

        frame_idx = 0

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # Sample frames at target FPS
            if frame_idx % frame_interval != 0:
                frame_idx += 1
                continue

            # Convert BGR to RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Process with MediaPipe
            results = hands.process(rgb_frame)

            # Initialize frame landmarks (126 features: 21 × 3 × 2 hands)
            frame_landmarks = np.zeros(126, dtype=np.float32)
            has_left = False
            has_right = False

            if results.multi_hand_landmarks:
                for hand_landmarks, handedness in zip(
                    results.multi_hand_landmarks,
                    results.multi_handedness
                ):
                    # Determine hand type
                    hand_label = handedness.classification[0].label

                    # Calculate base index (left hand: 0-62, right hand: 63-125)
                    base_idx = 0 if hand_label == 'Left' else 63

                    if hand_label == 'Left':
                        has_left = True
                    else:
                        has_right = True

                    # Extract landmarks
                    for i, landmark in enumerate(hand_landmarks.landmark):
                        if i < 21:  # 21 hand landmarks
                            idx = base_idx + i * 3
                            frame_landmarks[idx] = landmark.x
                            frame_landmarks[idx + 1] = landmark.y
                            frame_landmarks[idx + 2] = landmark.z

            landmarks_list.append(frame_landmarks)
            hand_presence_list.append({'left': has_left, 'right': has_right})

            frame_idx += 1

    cap.release()

    if len(landmarks_list) == 0:
        return None, {'error': 'No frames extracted'}

    landmarks_array = np.array(landmarks_list, dtype=np.float32)

    metadata = {
        'original_fps': original_fps,
        'target_fps': target_fps,
        'original_frames': total_frames,
        'extracted_frames': len(landmarks_list),
        'width': width,
        'height': height,
        'duration_sec': total_frames / original_fps if original_fps > 0 else 0,
        'hand_presence': hand_presence_list,
    }

    return landmarks_array, metadata


def process_sign_directory(
    sign_dir: Path,
    output_dir: Path,
    target_fps: float = 30.0,
) -> dict:
    """Process all videos for a sign and save landmarks."""
    sign = sign_dir.name
    sign_output_dir = output_dir / sign
    os.makedirs(sign_output_dir, exist_ok=True)

    stats = {
        'sign': sign,
        'total_videos': 0,
        'successful': 0,
        'failed': 0,
        'total_frames': 0,
    }

    video_files = list(sign_dir.glob('*.mp4')) + list(sign_dir.glob('*.webm'))
    stats['total_videos'] = len(video_files)

    for video_path in video_files:
        video_name = video_path.stem
        landmarks_path = sign_output_dir / f"{video_name}.npy"
        metadata_path = sign_output_dir / f"{video_name}_meta.json"

        # Skip if already processed
        if landmarks_path.exists() and metadata_path.exists():
            # Load existing metadata to count frames
            with open(metadata_path, 'r') as f:
                meta = json.load(f)
            stats['successful'] += 1
            stats['total_frames'] += meta.get('extracted_frames', 0)
            continue

        # Extract landmarks
        landmarks, metadata = extract_landmarks_from_video(video_path, target_fps)

        if landmarks is not None:
            # Save landmarks as numpy array
            np.save(landmarks_path, landmarks)

            # Save metadata
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            stats['successful'] += 1
            stats['total_frames'] += len(landmarks)
        else:
            stats['failed'] += 1
            print(f"  Failed: {video_path.name} - {metadata.get('error', 'Unknown error')}")

    return stats


def create_train_val_test_split(
    landmarks_dir: Path,
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    seed: int = 42,
) -> dict:
    """Create train/validation/test splits for the dataset."""
    np.random.seed(seed)

    splits = {'train': [], 'val': [], 'test': []}

    for sign_dir in landmarks_dir.iterdir():
        if not sign_dir.is_dir():
            continue

        sign = sign_dir.name
        npy_files = list(sign_dir.glob('*.npy'))

        # Shuffle files
        np.random.shuffle(npy_files)

        n_files = len(npy_files)
        n_train = int(n_files * train_ratio)
        n_val = int(n_files * val_ratio)

        for i, npy_path in enumerate(npy_files):
            entry = {
                'sign': sign,
                'path': str(npy_path.relative_to(landmarks_dir)),
            }

            if i < n_train:
                splits['train'].append(entry)
            elif i < n_train + n_val:
                splits['val'].append(entry)
            else:
                splits['test'].append(entry)

    return splits


def main():
    parser = argparse.ArgumentParser(description='Extract landmarks from WLASL videos')
    parser.add_argument('--input', type=str, default='./data/wlasl',
                        help='Input directory with video files')
    parser.add_argument('--output', type=str, default='./data/landmarks',
                        help='Output directory for landmark files')
    parser.add_argument('--fps', type=float, default=30.0,
                        help='Target FPS for landmark extraction')
    parser.add_argument('--split', action='store_true',
                        help='Create train/val/test splits')
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"Error: Input directory not found: {input_dir}")
        return

    os.makedirs(output_dir, exist_ok=True)

    # Find all sign directories
    sign_dirs = [d for d in input_dir.iterdir() if d.is_dir()]

    if len(sign_dirs) == 0:
        print(f"No sign directories found in {input_dir}")
        return

    print(f"Found {len(sign_dirs)} sign directories")

    # Process each sign
    total_stats = {
        'total_signs': len(sign_dirs),
        'total_videos': 0,
        'successful': 0,
        'failed': 0,
        'total_frames': 0,
    }

    for sign_dir in tqdm(sign_dirs, desc="Processing signs"):
        stats = process_sign_directory(sign_dir, output_dir, args.fps)

        total_stats['total_videos'] += stats['total_videos']
        total_stats['successful'] += stats['successful']
        total_stats['failed'] += stats['failed']
        total_stats['total_frames'] += stats['total_frames']

        tqdm.write(f"  {stats['sign']}: {stats['successful']}/{stats['total_videos']} videos, {stats['total_frames']} frames")

    print(f"\nExtraction complete!")
    print(f"  Signs: {total_stats['total_signs']}")
    print(f"  Videos: {total_stats['successful']}/{total_stats['total_videos']} successful")
    print(f"  Total frames: {total_stats['total_frames']}")
    print(f"  Output: {output_dir}")

    # Save extraction stats
    stats_path = output_dir / "extraction_stats.json"
    with open(stats_path, 'w') as f:
        json.dump(total_stats, f, indent=2)

    # Create train/val/test splits
    if args.split:
        print("\nCreating train/val/test splits...")
        splits = create_train_val_test_split(output_dir)

        splits_path = output_dir / "splits.json"
        with open(splits_path, 'w') as f:
            json.dump(splits, f, indent=2)

        print(f"  Train: {len(splits['train'])} samples")
        print(f"  Val: {len(splits['val'])} samples")
        print(f"  Test: {len(splits['test'])} samples")
        print(f"  Splits saved to: {splits_path}")


if __name__ == '__main__':
    main()
