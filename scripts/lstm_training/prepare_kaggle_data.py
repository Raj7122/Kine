#!/usr/bin/env python3
"""
Prepare Kaggle Datasets for CNN-LSTM Training

Converts downloaded Kaggle datasets to the format expected by train.py:
- X_train.npy, X_val.npy, X_test.npy: Shape (samples, 16, 63)
- y_train.npy, y_val.npy, y_test.npy: Integer labels
- metadata.json: Vocabulary and configuration

Supports:
1. WLASL Processed - Extract landmarks from video frames
2. Sign Language for LSTM - Already formatted sequences

Usage:
    python prepare_kaggle_data.py --dataset lstm-ready
    python prepare_kaggle_data.py --dataset wlasl --signs 25
"""

import argparse
import json
import os
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import numpy as np
from tqdm import tqdm

# Try importing optional dependencies
try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    import mediapipe as mp
    HAS_MEDIAPIPE = True
except ImportError:
    HAS_MEDIAPIPE = False


# Configuration matching our CNN-LSTM architecture
WINDOW_SIZE = 16      # Frames per sample
STRIDE = 8            # 50% overlap
FEATURE_COUNT = 63    # Single dominant hand (21 landmarks × 3 coords)

# WLASL-25 vocabulary (most common signs)
WLASL_25_SIGNS = [
    'book', 'drink', 'computer', 'before', 'chair',
    'go', 'clothes', 'who', 'candy', 'cousin',
    'deaf', 'fine', 'help', 'no', 'thin',
    'walk', 'year', 'yes', 'all', 'black',
    'cool', 'finish', 'hot', 'like', 'many',
]


def prepare_lstm_ready_dataset(
    input_dir: Path,
    output_dir: Path,
    train_split: float = 0.7,
    val_split: float = 0.15,
) -> Dict:
    """
    Prepare the 'Sign Language for LSTM' Kaggle dataset.

    This dataset typically contains:
    - Numpy arrays or CSV files with pre-extracted features
    - Labels for sentences like "I love you", "Thank you"
    """
    print("\nPreparing Sign Language for LSTM dataset...")
    print(f"Input: {input_dir}")

    # Look for data files
    data_files = list(input_dir.rglob('*.npy')) + list(input_dir.rglob('*.csv'))
    print(f"Found {len(data_files)} data files")

    X_all = []
    y_all = []
    vocabulary = []

    # Try to find pre-formatted data
    for pattern in ['X*.npy', 'data*.npy', 'features*.npy', 'landmarks*.npy']:
        matches = list(input_dir.rglob(pattern))
        if matches:
            print(f"Found feature files: {[m.name for m in matches]}")

    for pattern in ['y*.npy', 'labels*.npy', 'targets*.npy']:
        matches = list(input_dir.rglob(pattern))
        if matches:
            print(f"Found label files: {[m.name for m in matches]}")

    # Common structure: organized by label folders
    label_dirs = [d for d in input_dir.iterdir() if d.is_dir()]

    if label_dirs:
        print(f"\nFound {len(label_dirs)} label directories")
        vocabulary = sorted([d.name for d in label_dirs])
        print(f"Labels: {vocabulary[:10]}{'...' if len(vocabulary) > 10 else ''}")

        for label_idx, label_dir in enumerate(tqdm(label_dirs, desc="Processing labels")):
            label_name = label_dir.name
            if label_name not in vocabulary:
                continue

            # Load all samples for this label
            sample_files = list(label_dir.rglob('*.npy'))

            for sample_file in sample_files:
                try:
                    data = np.load(sample_file)

                    # Handle different data formats
                    samples = convert_to_standard_format(data)

                    for sample in samples:
                        X_all.append(sample)
                        y_all.append(label_idx)
                except Exception as e:
                    print(f"  Warning: Could not load {sample_file}: {e}")
                    continue

    # Try loading single files if no label dirs
    if not X_all:
        print("\nTrying to load from single data files...")

        # Look for common file patterns
        for x_pattern in ['X_train.npy', 'X.npy', 'data.npy', 'features.npy']:
            x_file = input_dir / x_pattern
            if x_file.exists():
                print(f"Loading features from {x_file}")
                X_data = np.load(x_file)
                print(f"  Shape: {X_data.shape}")
                break
        else:
            X_data = None

        for y_pattern in ['y_train.npy', 'y.npy', 'labels.npy', 'targets.npy']:
            y_file = input_dir / y_pattern
            if y_file.exists():
                print(f"Loading labels from {y_file}")
                y_data = np.load(y_file)
                print(f"  Shape: {y_data.shape}")
                break
        else:
            y_data = None

        if X_data is not None and y_data is not None:
            # Convert to standard format
            for i in range(len(X_data)):
                samples = convert_to_standard_format(X_data[i:i+1])
                for sample in samples:
                    X_all.append(sample)
                    y_all.append(int(y_data[i]))

            # Infer vocabulary from labels
            unique_labels = sorted(set(y_all))
            vocabulary = [f"sign_{i}" for i in unique_labels]

    if not X_all:
        print("\nCould not find usable data. Please check the dataset structure.")
        print("Expected: Either label folders with .npy files, or X.npy/y.npy files")
        return {'error': 'No data found'}

    # Convert to numpy arrays
    X_all = np.array(X_all, dtype=np.float32)
    y_all = np.array(y_all, dtype=np.int32)

    print(f"\nTotal samples: {len(X_all)}")
    print(f"Feature shape: {X_all.shape}")
    print(f"Vocabulary size: {len(vocabulary)}")

    # Split data
    return split_and_save(X_all, y_all, vocabulary, output_dir, train_split, val_split)


def prepare_wlasl_dataset(
    input_dir: Path,
    output_dir: Path,
    num_signs: int = 25,
    train_split: float = 0.7,
    val_split: float = 0.15,
) -> Dict:
    """
    Prepare the WLASL Processed Kaggle dataset.

    This dataset contains video clips organized by sign label.
    We extract MediaPipe landmarks and format for LSTM.
    """
    if not HAS_CV2 or not HAS_MEDIAPIPE:
        print("Error: WLASL processing requires opencv-python and mediapipe")
        print("Install with: pip install opencv-python mediapipe")
        return {'error': 'Missing dependencies'}

    print(f"\nPreparing WLASL dataset (top {num_signs} signs)...")
    print(f"Input: {input_dir}")

    # Initialize MediaPipe
    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    # Find video files organized by label
    label_dirs = [d for d in input_dir.iterdir() if d.is_dir()]

    if not label_dirs:
        # Try common subdirectories
        for subdir in ['videos', 'clips', 'data']:
            sub_path = input_dir / subdir
            if sub_path.exists():
                label_dirs = [d for d in sub_path.iterdir() if d.is_dir()]
                if label_dirs:
                    break

    if not label_dirs:
        print("Could not find label directories in WLASL dataset")
        return {'error': 'Invalid dataset structure'}

    print(f"Found {len(label_dirs)} sign labels")

    # Select top signs (by sample count or predefined list)
    vocabulary = WLASL_25_SIGNS[:num_signs] if num_signs <= 25 else sorted([d.name.lower() for d in label_dirs])[:num_signs]

    X_all = []
    y_all = []

    for label_idx, label_name in enumerate(tqdm(vocabulary, desc="Processing signs")):
        # Find matching directory (case-insensitive)
        label_dir = None
        for d in label_dirs:
            if d.name.lower() == label_name.lower():
                label_dir = d
                break

        if not label_dir or not label_dir.exists():
            print(f"  Warning: No directory for '{label_name}'")
            continue

        # Process video files
        video_files = list(label_dir.glob('*.mp4')) + list(label_dir.glob('*.avi')) + list(label_dir.glob('*.mov'))

        for video_file in video_files[:50]:  # Limit samples per sign
            landmarks = extract_landmarks_from_video(video_file, hands)

            if landmarks is not None and len(landmarks) >= WINDOW_SIZE:
                # Create overlapping windows
                windows = create_overlapping_windows(landmarks)
                for window in windows:
                    X_all.append(window)
                    y_all.append(label_idx)

    hands.close()

    if not X_all:
        print("No samples extracted. Check video format and MediaPipe installation.")
        return {'error': 'No samples extracted'}

    X_all = np.array(X_all, dtype=np.float32)
    y_all = np.array(y_all, dtype=np.int32)

    print(f"\nTotal samples: {len(X_all)}")
    print(f"Feature shape: {X_all.shape}")

    return split_and_save(X_all, y_all, vocabulary, output_dir, train_split, val_split)


def convert_to_standard_format(data: np.ndarray) -> List[np.ndarray]:
    """
    Convert various data formats to our standard: (WINDOW_SIZE, FEATURE_COUNT)

    Handles:
    - (frames, features) → create windows
    - (samples, frames, features) → extract/pad each
    - (frames, landmarks, coords) → flatten and window
    """
    samples = []

    if len(data.shape) == 2:
        # (frames, features) - single sequence
        frames, features = data.shape

        # Adjust features if needed
        if features > FEATURE_COUNT:
            # Take first hand only or downsample
            data = data[:, :FEATURE_COUNT]
        elif features < FEATURE_COUNT:
            # Pad with zeros
            padded = np.zeros((frames, FEATURE_COUNT), dtype=np.float32)
            padded[:, :features] = data
            data = padded

        # Create overlapping windows
        samples = create_overlapping_windows(data)

    elif len(data.shape) == 3:
        # Could be (samples, frames, features) or (frames, landmarks, coords)
        dim1, dim2, dim3 = data.shape

        if dim3 == 3 and dim2 == 21:
            # (frames, 21 landmarks, 3 coords) → flatten
            data = data.reshape(dim1, -1)  # (frames, 63)
            samples = create_overlapping_windows(data)

        elif dim2 == WINDOW_SIZE or abs(dim2 - WINDOW_SIZE) < 5:
            # (samples, ~frames, features) - already windowed
            for i in range(dim1):
                sample = data[i]
                if sample.shape[0] != WINDOW_SIZE:
                    sample = pad_or_truncate(sample, WINDOW_SIZE)
                if sample.shape[1] != FEATURE_COUNT:
                    sample = adjust_features(sample, FEATURE_COUNT)
                samples.append(sample)

        else:
            # Treat each as a sequence and window it
            for i in range(dim1):
                seq = data[i]
                if seq.shape[-1] != FEATURE_COUNT:
                    seq = adjust_features(seq, FEATURE_COUNT)
                windows = create_overlapping_windows(seq)
                samples.extend(windows)

    return samples


def create_overlapping_windows(
    landmarks: np.ndarray,
    window_size: int = WINDOW_SIZE,
    stride: int = STRIDE,
) -> List[np.ndarray]:
    """Create overlapping windows from a sequence."""
    windows = []
    n_frames = len(landmarks)

    if n_frames < window_size:
        # Pad short sequences
        windows.append(pad_or_truncate(landmarks, window_size))
        return windows

    for start in range(0, n_frames - window_size + 1, stride):
        window = landmarks[start:start + window_size]
        windows.append(window)

    return windows


def pad_or_truncate(data: np.ndarray, target_length: int) -> np.ndarray:
    """Pad or truncate sequence to target length."""
    n_frames = len(data)
    features = data.shape[1] if len(data.shape) > 1 else FEATURE_COUNT

    if n_frames == target_length:
        return data

    if n_frames > target_length:
        start = (n_frames - target_length) // 2
        return data[start:start + target_length]

    # Pad with zeros at beginning
    padding = np.zeros((target_length - n_frames, features), dtype=np.float32)
    return np.concatenate([padding, data], axis=0)


def adjust_features(data: np.ndarray, target_features: int) -> np.ndarray:
    """Adjust feature dimension to target."""
    current_features = data.shape[-1]

    if current_features == target_features:
        return data

    if current_features > target_features:
        return data[..., :target_features]

    # Pad
    shape = list(data.shape)
    shape[-1] = target_features
    padded = np.zeros(shape, dtype=np.float32)
    padded[..., :current_features] = data
    return padded


def extract_landmarks_from_video(
    video_path: Path,
    hands,
    max_frames: int = 100,
) -> Optional[np.ndarray]:
    """Extract hand landmarks from video using MediaPipe."""
    if not HAS_CV2:
        return None

    cap = cv2.VideoCapture(str(video_path))
    landmarks_list = []

    frame_count = 0
    while cap.isOpened() and frame_count < max_frames:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1

        # Convert to RGB for MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)

        if results.multi_hand_landmarks:
            # Use first detected hand (dominant)
            hand = results.multi_hand_landmarks[0]
            landmarks = []
            for lm in hand.landmark:
                landmarks.extend([lm.x, lm.y, lm.z])
            landmarks_list.append(landmarks)
        else:
            # No hand detected - use zeros
            landmarks_list.append([0.0] * FEATURE_COUNT)

    cap.release()

    if not landmarks_list:
        return None

    return np.array(landmarks_list, dtype=np.float32)


def split_and_save(
    X: np.ndarray,
    y: np.ndarray,
    vocabulary: List[str],
    output_dir: Path,
    train_split: float,
    val_split: float,
) -> Dict:
    """Split data and save to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Shuffle
    indices = np.random.permutation(len(X))
    X = X[indices]
    y = y[indices]

    # Split
    n = len(X)
    train_end = int(n * train_split)
    val_end = int(n * (train_split + val_split))

    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]

    # Save
    np.save(output_dir / 'X_train.npy', X_train)
    np.save(output_dir / 'y_train.npy', y_train)
    np.save(output_dir / 'X_val.npy', X_val)
    np.save(output_dir / 'y_val.npy', y_val)
    np.save(output_dir / 'X_test.npy', X_test)
    np.save(output_dir / 'y_test.npy', y_test)

    # Metadata
    metadata = {
        'vocabulary': vocabulary,
        'label_to_idx': {sign: idx for idx, sign in enumerate(vocabulary)},
        'window_size': WINDOW_SIZE,
        'stride': STRIDE,
        'feature_count': FEATURE_COUNT,
        'single_hand': True,
        'overlapping_windows': True,
        'stats': {
            'train': {'n_samples': len(X_train), 'shape': list(X_train.shape)},
            'val': {'n_samples': len(X_val), 'shape': list(X_val.shape)},
            'test': {'n_samples': len(X_test), 'shape': list(X_test.shape)},
        },
    }

    with open(output_dir / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\n✓ Data saved to {output_dir}")
    print(f"  Train: {X_train.shape}")
    print(f"  Val: {X_val.shape}")
    print(f"  Test: {X_test.shape}")
    print(f"  Vocabulary: {len(vocabulary)} signs")

    return metadata


def main():
    parser = argparse.ArgumentParser(
        description='Prepare Kaggle datasets for CNN-LSTM training'
    )
    parser.add_argument(
        '--dataset',
        type=str,
        choices=['lstm-ready', 'wlasl'],
        default='lstm-ready',
        help='Dataset to prepare'
    )
    parser.add_argument(
        '--input',
        type=str,
        default=None,
        help='Input directory (default: ./data/<dataset>)'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='./data/processed',
        help='Output directory for processed data'
    )
    parser.add_argument(
        '--signs',
        type=int,
        default=25,
        help='Number of signs to include (for WLASL)'
    )
    args = parser.parse_args()

    # Determine input directory
    if args.input:
        input_dir = Path(args.input)
    else:
        if args.dataset == 'lstm-ready':
            input_dir = Path('./data/lstm_ready')
        else:
            input_dir = Path('./data/wlasl_processed')

    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"Error: Input directory not found: {input_dir}")
        print(f"\nDownload the dataset first:")
        print(f"  python download_kaggle_datasets.py --dataset {args.dataset}")
        return

    print("=" * 60)
    print("Kaggle Dataset Preparation for CNN-LSTM")
    print("=" * 60)
    print(f"Dataset: {args.dataset}")
    print(f"Input: {input_dir}")
    print(f"Output: {output_dir}")
    print(f"Window size: {WINDOW_SIZE} frames")
    print(f"Features: {FEATURE_COUNT} (single hand)")

    if args.dataset == 'lstm-ready':
        result = prepare_lstm_ready_dataset(input_dir, output_dir)
    else:
        result = prepare_wlasl_dataset(input_dir, output_dir, num_signs=args.signs)

    if 'error' not in result:
        print("\n" + "=" * 60)
        print("✓ Preparation complete!")
        print("\nNext steps:")
        print("  1. python train.py --data ./data/processed --epochs 150")
        print("  2. python export_tfjs.py")
        print("  3. Copy model to public/models/asl_cnn_lstm_25.json")


if __name__ == '__main__':
    main()
