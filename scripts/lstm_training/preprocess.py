#!/usr/bin/env python3
"""
Data Preprocessing Script
Preprocesses extracted landmarks for LSTM training.

Features:
- Wrist-centered normalization
- Unit bounding box scaling
- Data augmentation (time warping, spatial jitter, dropout)
- Sequence padding/truncation

Usage:
    python preprocess.py --input ./data/landmarks --output ./data/processed
"""

import argparse
import json
import os
from pathlib import Path
from typing import List, Tuple, Optional
import numpy as np
from tqdm import tqdm


# Constants
WINDOW_SIZE = 32  # Must match LSTM_WINDOW_SIZE in TypeScript
FEATURE_COUNT = 126  # 21 landmarks × 3 coords × 2 hands


def normalize_landmarks(landmarks: np.ndarray) -> np.ndarray:
    """
    Normalize landmarks to be wrist-centered and unit-scaled.

    Args:
        landmarks: Array of shape (n_frames, 126)

    Returns:
        Normalized array of same shape
    """
    normalized = landmarks.copy()

    for frame_idx in range(len(normalized)):
        frame = normalized[frame_idx]

        # Normalize left hand (indices 0-62)
        normalize_hand(frame, 0, 63)

        # Normalize right hand (indices 63-125)
        normalize_hand(frame, 63, 126)

    return normalized


def normalize_hand(frame: np.ndarray, start: int, end: int) -> None:
    """Normalize a single hand's landmarks in place."""
    # Extract wrist position (first 3 values)
    wrist_x = frame[start]
    wrist_y = frame[start + 1]
    wrist_z = frame[start + 2]

    # Skip if no hand data (all zeros)
    if wrist_x == 0 and wrist_y == 0 and wrist_z == 0:
        return

    # Center around wrist
    for i in range(start, end, 3):
        frame[i] -= wrist_x
        frame[i + 1] -= wrist_y
        frame[i + 2] -= wrist_z

    # Calculate bounding box for scaling
    x_coords = frame[start:end:3]
    y_coords = frame[start + 1:end:3]

    x_range = np.max(x_coords) - np.min(x_coords)
    y_range = np.max(y_coords) - np.min(y_coords)

    scale = max(x_range, y_range, 0.001)  # Prevent division by zero

    # Scale to unit bounding box
    for i in range(start, end, 3):
        frame[i] /= scale
        frame[i + 1] /= scale
        frame[i + 2] /= scale


def pad_or_truncate(
    landmarks: np.ndarray,
    target_length: int = WINDOW_SIZE,
) -> np.ndarray:
    """Pad or truncate sequence to target length."""
    n_frames = len(landmarks)

    if n_frames == target_length:
        return landmarks

    if n_frames > target_length:
        # Truncate - take center portion for most representative frames
        start = (n_frames - target_length) // 2
        return landmarks[start:start + target_length]

    # Pad with zeros at the beginning
    padding = np.zeros((target_length - n_frames, FEATURE_COUNT), dtype=np.float32)
    return np.concatenate([padding, landmarks], axis=0)


def time_warp(landmarks: np.ndarray, factor_range: Tuple[float, float] = (0.8, 1.2)) -> np.ndarray:
    """
    Apply time warping augmentation.

    Args:
        landmarks: Array of shape (n_frames, 126)
        factor_range: Range of speed factors (0.8 = slower, 1.2 = faster)

    Returns:
        Time-warped array
    """
    factor = np.random.uniform(*factor_range)
    n_frames = len(landmarks)
    new_length = int(n_frames * factor)

    if new_length == n_frames or new_length < 2:
        return landmarks

    # Interpolate to new length
    old_indices = np.arange(n_frames)
    new_indices = np.linspace(0, n_frames - 1, new_length)

    warped = np.zeros((new_length, FEATURE_COUNT), dtype=np.float32)

    for feature_idx in range(FEATURE_COUNT):
        warped[:, feature_idx] = np.interp(new_indices, old_indices, landmarks[:, feature_idx])

    return warped


def spatial_jitter(landmarks: np.ndarray, noise_std: float = 0.02) -> np.ndarray:
    """
    Add spatial jitter (random noise) to landmarks.

    Args:
        landmarks: Array of shape (n_frames, 126)
        noise_std: Standard deviation of Gaussian noise

    Returns:
        Jittered array
    """
    noise = np.random.normal(0, noise_std, landmarks.shape).astype(np.float32)
    return landmarks + noise


def landmark_dropout(landmarks: np.ndarray, dropout_prob: float = 0.1) -> np.ndarray:
    """
    Randomly zero out landmarks to simulate occlusion.

    Args:
        landmarks: Array of shape (n_frames, 126)
        dropout_prob: Probability of dropping each landmark

    Returns:
        Array with some landmarks zeroed
    """
    augmented = landmarks.copy()

    # Create dropout mask for each frame
    for frame_idx in range(len(augmented)):
        for landmark_idx in range(21):  # 21 landmarks per hand
            if np.random.random() < dropout_prob:
                # Zero out this landmark for both hands
                # Left hand
                base_idx = landmark_idx * 3
                augmented[frame_idx, base_idx:base_idx + 3] = 0

                # Right hand
                base_idx = 63 + landmark_idx * 3
                augmented[frame_idx, base_idx:base_idx + 3] = 0

    return augmented


def augment_sample(
    landmarks: np.ndarray,
    augment_config: dict,
) -> List[np.ndarray]:
    """
    Generate augmented versions of a sample.

    Args:
        landmarks: Original landmarks array
        augment_config: Configuration for augmentation

    Returns:
        List of augmented samples (including original)
    """
    samples = [landmarks]  # Always include original

    n_augments = augment_config.get('n_augments', 3)

    for _ in range(n_augments):
        augmented = landmarks.copy()

        # Apply time warping
        if augment_config.get('time_warp', True):
            augmented = time_warp(augmented, (0.8, 1.2))

        # Apply spatial jitter
        if augment_config.get('spatial_jitter', True):
            augmented = spatial_jitter(augmented, 0.02)

        # Apply landmark dropout
        if augment_config.get('dropout', True):
            augmented = landmark_dropout(augmented, 0.1)

        samples.append(augmented)

    return samples


def process_sample(
    landmarks_path: Path,
    augment: bool = True,
    augment_config: Optional[dict] = None,
) -> List[np.ndarray]:
    """
    Process a single landmark file.

    Args:
        landmarks_path: Path to .npy file
        augment: Whether to apply augmentation
        augment_config: Augmentation configuration

    Returns:
        List of processed samples
    """
    # Load landmarks
    landmarks = np.load(landmarks_path)

    if len(landmarks) == 0:
        return []

    # Normalize
    normalized = normalize_landmarks(landmarks)

    # Augment if requested
    if augment and augment_config:
        samples = augment_sample(normalized, augment_config)
    else:
        samples = [normalized]

    # Pad/truncate all samples to fixed length
    processed = [pad_or_truncate(s, WINDOW_SIZE) for s in samples]

    return processed


def create_dataset(
    splits: dict,
    landmarks_dir: Path,
    output_dir: Path,
    vocabulary: List[str],
    augment_train: bool = True,
) -> dict:
    """
    Create processed dataset from splits.

    Args:
        splits: Dict with 'train', 'val', 'test' splits
        landmarks_dir: Directory containing landmark files
        output_dir: Output directory for processed data
        vocabulary: List of sign labels (for label encoding)
        augment_train: Whether to augment training data

    Returns:
        Dataset statistics
    """
    os.makedirs(output_dir, exist_ok=True)

    # Create label mapping
    label_to_idx = {sign: idx for idx, sign in enumerate(vocabulary)}

    augment_config = {
        'n_augments': 3,
        'time_warp': True,
        'spatial_jitter': True,
        'dropout': True,
    }

    stats = {}

    for split_name, samples in splits.items():
        print(f"\nProcessing {split_name} split...")

        X_list = []
        y_list = []
        should_augment = augment_train and split_name == 'train'

        for sample in tqdm(samples, desc=f"  {split_name}"):
            sign = sample['sign']
            rel_path = sample['path']

            if sign not in label_to_idx:
                continue

            label_idx = label_to_idx[sign]
            landmarks_path = landmarks_dir / rel_path

            if not landmarks_path.exists():
                continue

            # Process sample
            processed_samples = process_sample(
                landmarks_path,
                augment=should_augment,
                augment_config=augment_config,
            )

            for processed in processed_samples:
                X_list.append(processed)
                y_list.append(label_idx)

        if len(X_list) == 0:
            print(f"  Warning: No samples for {split_name}")
            continue

        # Convert to numpy arrays
        X = np.array(X_list, dtype=np.float32)
        y = np.array(y_list, dtype=np.int32)

        # Shuffle training data
        if split_name == 'train':
            indices = np.random.permutation(len(X))
            X = X[indices]
            y = y[indices]

        # Save
        np.save(output_dir / f"X_{split_name}.npy", X)
        np.save(output_dir / f"y_{split_name}.npy", y)

        stats[split_name] = {
            'n_samples': len(X),
            'shape': list(X.shape),
        }

        print(f"  {split_name}: {len(X)} samples, shape {X.shape}")

    # Save metadata
    metadata = {
        'vocabulary': vocabulary,
        'label_to_idx': label_to_idx,
        'window_size': WINDOW_SIZE,
        'feature_count': FEATURE_COUNT,
        'stats': stats,
    }

    with open(output_dir / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    return stats


def main():
    parser = argparse.ArgumentParser(description='Preprocess landmarks for LSTM training')
    parser.add_argument('--input', type=str, default='./data/landmarks',
                        help='Input directory with landmark files')
    parser.add_argument('--output', type=str, default='./data/processed',
                        help='Output directory for processed data')
    parser.add_argument('--no-augment', action='store_true',
                        help='Disable data augmentation')
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"Error: Input directory not found: {input_dir}")
        return

    # Load splits
    splits_path = input_dir / 'splits.json'
    if not splits_path.exists():
        print(f"Error: Splits file not found: {splits_path}")
        print("Run extract_landmarks.py with --split first")
        return

    with open(splits_path, 'r') as f:
        splits = json.load(f)

    # Get vocabulary from directory structure
    vocabulary = sorted([d.name for d in input_dir.iterdir() if d.is_dir()])

    if len(vocabulary) == 0:
        print("No sign directories found")
        return

    print(f"Vocabulary: {len(vocabulary)} signs")
    print(f"Signs: {vocabulary}")

    # Create dataset
    stats = create_dataset(
        splits,
        input_dir,
        output_dir,
        vocabulary,
        augment_train=not args.no_augment,
    )

    print(f"\nPreprocessing complete!")
    print(f"Output: {output_dir}")


if __name__ == '__main__':
    main()
