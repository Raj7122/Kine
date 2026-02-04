#!/usr/bin/env python3
"""
Data Preprocessing Script for Research-Grade ASL Recognition
Preprocesses extracted landmarks for CNN-LSTM training.

Features:
- Single dominant hand extraction (63 features)
- Wrist-centered normalization
- Unit bounding box scaling
- Overlapping windows (50% overlap)
- Data augmentation (time warping, spatial jitter, dropout)

Research basis:
- Indian ISL: 97.75% precision
- FAU: 98% accuracy

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


# Constants - Research-grade values
WINDOW_SIZE = 16  # ~530ms at 30fps (research optimal)
STRIDE = 8        # 50% overlap for dense sampling
FEATURE_COUNT = 63  # 21 landmarks × 3 coords × 1 dominant hand

# Legacy constants for backward compatibility
LEGACY_WINDOW_SIZE = 32
LEGACY_FEATURE_COUNT = 126


def extract_dominant_hand(landmarks: np.ndarray) -> np.ndarray:
    """
    Extract single dominant hand from two-hand landmarks.
    Prefers right hand (more common for signing).

    Args:
        landmarks: Array of shape (n_frames, 126) with both hands

    Returns:
        Array of shape (n_frames, 63) with dominant hand only
    """
    n_frames = len(landmarks)
    single_hand = np.zeros((n_frames, 63), dtype=np.float32)

    for frame_idx in range(n_frames):
        frame = landmarks[frame_idx]

        # Check if right hand has data (indices 63-125)
        right_wrist = frame[63:66]
        left_wrist = frame[0:3]

        has_right = not (right_wrist[0] == 0 and right_wrist[1] == 0 and right_wrist[2] == 0)
        has_left = not (left_wrist[0] == 0 and left_wrist[1] == 0 and left_wrist[2] == 0)

        if has_right:
            # Use right hand
            single_hand[frame_idx] = frame[63:126]
        elif has_left:
            # Use left hand
            single_hand[frame_idx] = frame[0:63]
        # else: keep zeros (no hand detected)

    return single_hand


def normalize_landmarks(landmarks: np.ndarray, single_hand: bool = True) -> np.ndarray:
    """
    Normalize landmarks to be wrist-centered and unit-scaled.

    Args:
        landmarks: Array of shape (n_frames, 63) or (n_frames, 126)
        single_hand: If True, assumes single hand (63 features)

    Returns:
        Normalized array of same shape
    """
    normalized = landmarks.copy()
    feature_count = landmarks.shape[1] if len(landmarks.shape) > 1 else FEATURE_COUNT

    for frame_idx in range(len(normalized)):
        frame = normalized[frame_idx]

        if single_hand or feature_count == 63:
            # Single dominant hand (indices 0-62)
            normalize_hand(frame, 0, 63)
        else:
            # Legacy: both hands
            normalize_hand(frame, 0, 63)
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
    feature_count = landmarks.shape[1] if len(landmarks.shape) > 1 else FEATURE_COUNT

    if n_frames == target_length:
        return landmarks

    if n_frames > target_length:
        # Truncate - take center portion for most representative frames
        start = (n_frames - target_length) // 2
        return landmarks[start:start + target_length]

    # Pad with zeros at the beginning
    padding = np.zeros((target_length - n_frames, feature_count), dtype=np.float32)
    return np.concatenate([padding, landmarks], axis=0)


def create_overlapping_windows(
    landmarks: np.ndarray,
    window_size: int = WINDOW_SIZE,
    stride: int = STRIDE,
) -> List[np.ndarray]:
    """
    Create overlapping windows from a sequence of landmarks.
    This provides more training samples and denser temporal coverage.

    Args:
        landmarks: Array of shape (n_frames, features)
        window_size: Size of each window
        stride: Step between windows (stride < window_size = overlap)

    Returns:
        List of window arrays, each of shape (window_size, features)
    """
    n_frames = len(landmarks)
    windows = []

    if n_frames < window_size:
        # Sequence too short - pad and return single window
        windows.append(pad_or_truncate(landmarks, window_size))
        return windows

    # Create overlapping windows
    start = 0
    while start + window_size <= n_frames:
        window = landmarks[start:start + window_size]
        windows.append(window)
        start += stride

    # Handle remaining frames (if any) by creating a final window from the end
    if start < n_frames and start + window_size > n_frames:
        final_window = landmarks[-window_size:]
        # Only add if it's different from the last window
        if len(windows) == 0 or not np.array_equal(windows[-1], final_window):
            windows.append(final_window)

    return windows


def time_warp(landmarks: np.ndarray, factor_range: Tuple[float, float] = (0.8, 1.2)) -> np.ndarray:
    """
    Apply time warping augmentation.

    Args:
        landmarks: Array of shape (n_frames, features)
        factor_range: Range of speed factors (0.8 = slower, 1.2 = faster)

    Returns:
        Time-warped array
    """
    factor = np.random.uniform(*factor_range)
    n_frames = len(landmarks)
    feature_count = landmarks.shape[1] if len(landmarks.shape) > 1 else FEATURE_COUNT
    new_length = int(n_frames * factor)

    if new_length == n_frames or new_length < 2:
        return landmarks

    # Interpolate to new length
    old_indices = np.arange(n_frames)
    new_indices = np.linspace(0, n_frames - 1, new_length)

    warped = np.zeros((new_length, feature_count), dtype=np.float32)

    for feature_idx in range(feature_count):
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
        landmarks: Array of shape (n_frames, features)
        dropout_prob: Probability of dropping each landmark

    Returns:
        Array with some landmarks zeroed
    """
    augmented = landmarks.copy()
    feature_count = landmarks.shape[1] if len(landmarks.shape) > 1 else FEATURE_COUNT
    single_hand = feature_count == 63

    # Create dropout mask for each frame
    for frame_idx in range(len(augmented)):
        for landmark_idx in range(21):  # 21 landmarks per hand
            if np.random.random() < dropout_prob:
                # Zero out this landmark
                base_idx = landmark_idx * 3
                augmented[frame_idx, base_idx:base_idx + 3] = 0

                # Also drop from second hand if present (legacy mode)
                if not single_hand and feature_count > 63:
                    base_idx = 63 + landmark_idx * 3
                    if base_idx + 3 <= feature_count:
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
    use_overlapping_windows: bool = True,
    single_hand: bool = True,
) -> List[np.ndarray]:
    """
    Process a single landmark file with research-grade preprocessing.

    Args:
        landmarks_path: Path to .npy file
        augment: Whether to apply augmentation
        augment_config: Augmentation configuration
        use_overlapping_windows: Use 50% overlapping windows for dense sampling
        single_hand: Extract single dominant hand (63 features)

    Returns:
        List of processed samples
    """
    # Load landmarks
    landmarks = np.load(landmarks_path)

    if len(landmarks) == 0:
        return []

    # Extract single dominant hand if requested
    if single_hand and landmarks.shape[1] > 63:
        landmarks = extract_dominant_hand(landmarks)

    # Normalize
    normalized = normalize_landmarks(landmarks, single_hand=single_hand)

    # Augment if requested
    if augment and augment_config:
        samples = augment_sample(normalized, augment_config)
    else:
        samples = [normalized]

    # Create overlapping windows or pad/truncate
    processed = []
    for sample in samples:
        if use_overlapping_windows:
            windows = create_overlapping_windows(sample, WINDOW_SIZE, STRIDE)
            processed.extend(windows)
        else:
            processed.append(pad_or_truncate(sample, WINDOW_SIZE))

    return processed


def create_dataset(
    splits: dict,
    landmarks_dir: Path,
    output_dir: Path,
    vocabulary: List[str],
    augment_train: bool = True,
    use_overlapping_windows: bool = True,
    single_hand: bool = True,
) -> dict:
    """
    Create processed dataset from splits with research-grade preprocessing.

    Args:
        splits: Dict with 'train', 'val', 'test' splits
        landmarks_dir: Directory containing landmark files
        output_dir: Output directory for processed data
        vocabulary: List of sign labels (for label encoding)
        augment_train: Whether to augment training data
        use_overlapping_windows: Use 50% overlapping windows
        single_hand: Extract single dominant hand (63 features)

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
    feature_count = 63 if single_hand else 126

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

            # Process sample with research-grade preprocessing
            processed_samples = process_sample(
                landmarks_path,
                augment=should_augment,
                augment_config=augment_config,
                use_overlapping_windows=use_overlapping_windows,
                single_hand=single_hand,
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
        'stride': STRIDE,
        'feature_count': feature_count,
        'single_hand': single_hand,
        'overlapping_windows': use_overlapping_windows,
        'stats': stats,
    }

    with open(output_dir / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    return stats


def main():
    parser = argparse.ArgumentParser(
        description='Preprocess landmarks for CNN-LSTM training (research-grade)'
    )
    parser.add_argument('--input', type=str, default='./data/landmarks',
                        help='Input directory with landmark files')
    parser.add_argument('--output', type=str, default='./data/processed',
                        help='Output directory for processed data')
    parser.add_argument('--no-augment', action='store_true',
                        help='Disable data augmentation')
    parser.add_argument('--no-overlap', action='store_true',
                        help='Disable overlapping windows (use single window per sample)')
    parser.add_argument('--both-hands', action='store_true',
                        help='Use both hands (legacy 126 features) instead of dominant hand')
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
    print(f"\nResearch-grade preprocessing:")
    print(f"  Window size: {WINDOW_SIZE} frames (~{WINDOW_SIZE/30*1000:.0f}ms at 30fps)")
    print(f"  Stride: {STRIDE} frames (50% overlap)")
    print(f"  Features: {'63 (single dominant hand)' if not args.both_hands else '126 (both hands)'}")
    print(f"  Overlapping windows: {'disabled' if args.no_overlap else 'enabled'}")

    # Create dataset
    stats = create_dataset(
        splits,
        input_dir,
        output_dir,
        vocabulary,
        augment_train=not args.no_augment,
        use_overlapping_windows=not args.no_overlap,
        single_hand=not args.both_hands,
    )

    print(f"\nPreprocessing complete!")
    print(f"Output: {output_dir}")


if __name__ == '__main__':
    main()
