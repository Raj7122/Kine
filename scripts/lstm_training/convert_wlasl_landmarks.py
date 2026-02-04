#!/usr/bin/env python3
"""
Convert WLASL Landmarks Dataset to CNN-LSTM Training Format

Converts the Kaggle WLASL-100-landmarks dataset (JSON) to numpy arrays
compatible with our train.py script.

Input format (JSON):
{
    "video_id": [{
        "keyframes": 22,
        "landmarks": {
            "0": {"pose": [...], "right": [...], "left": [...]},
            "1": {"pose": [...], "right": [...], "left": [...]},
            ...
        }
    }]
}

Output format (numpy):
- X_train.npy: (samples, 16, 63) - 16 frames, 63 features (single hand)
- y_train.npy: (samples,) - class indices

Usage:
    python convert_wlasl_landmarks.py --input ./data/wlasl_landmarks --output ./data/processed
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple
import numpy as np
from tqdm import tqdm


# Configuration matching our CNN-LSTM architecture
WINDOW_SIZE = 16      # Frames per sample
STRIDE = 8            # 50% overlap
FEATURE_COUNT = 63    # Single dominant hand (21 landmarks × 3 coords)


def load_class_mapping(classes_file: Path) -> Dict[int, str]:
    """Load class ID to name mapping."""
    mapping = {}
    with open(classes_file, 'r') as f:
        for line in f:
            parts = line.strip().split('\t')
            if len(parts) == 2:
                class_id, class_name = parts
                mapping[int(class_id)] = class_name
    return mapping


def extract_hand_landmarks(frame_data: Dict) -> np.ndarray:
    """
    Extract dominant hand landmarks from a single frame.
    Prefers right hand, falls back to left.

    Returns: (63,) array of [x, y, z] × 21 landmarks
    """
    features = np.zeros(FEATURE_COUNT, dtype=np.float32)

    right_hand = frame_data.get('right', [])
    left_hand = frame_data.get('left', [])

    # Check if right hand has data (non-zero)
    has_right = any(sum(lm) != 0 for lm in right_hand) if right_hand else False
    has_left = any(sum(lm) != 0 for lm in left_hand) if left_hand else False

    # Select dominant hand (prefer right)
    if has_right:
        hand_data = right_hand
    elif has_left:
        hand_data = left_hand
    else:
        return features  # No hand detected

    # Flatten landmarks
    for i, landmark in enumerate(hand_data[:21]):
        if i * 3 + 2 < FEATURE_COUNT:
            features[i * 3] = landmark[0]      # x
            features[i * 3 + 1] = landmark[1]  # y
            features[i * 3 + 2] = landmark[2]  # z

    return features


def normalize_landmarks(sequence: np.ndarray) -> np.ndarray:
    """
    Normalize landmarks to be wrist-centered and unit-scaled.

    Args:
        sequence: (frames, 63) array

    Returns:
        Normalized array of same shape
    """
    normalized = sequence.copy()

    for frame_idx in range(len(normalized)):
        frame = normalized[frame_idx]

        # Wrist is first landmark (indices 0, 1, 2)
        wrist_x, wrist_y, wrist_z = frame[0], frame[1], frame[2]

        # Skip if no hand data
        if wrist_x == 0 and wrist_y == 0 and wrist_z == 0:
            continue

        # Center around wrist
        for i in range(0, FEATURE_COUNT, 3):
            frame[i] -= wrist_x
            frame[i + 1] -= wrist_y
            frame[i + 2] -= wrist_z

        # Calculate bounding box
        x_coords = frame[0:FEATURE_COUNT:3]
        y_coords = frame[1:FEATURE_COUNT:3]

        x_range = np.max(x_coords) - np.min(x_coords)
        y_range = np.max(y_coords) - np.min(y_coords)
        scale = max(x_range, y_range, 0.001)

        # Scale to unit bounding box
        for i in range(0, FEATURE_COUNT, 3):
            frame[i] /= scale
            frame[i + 1] /= scale
            frame[i + 2] /= scale

    return normalized


def create_windows(sequence: np.ndarray) -> List[np.ndarray]:
    """Create overlapping windows from a sequence."""
    windows = []
    n_frames = len(sequence)

    if n_frames < WINDOW_SIZE:
        # Pad short sequences
        padding = np.zeros((WINDOW_SIZE - n_frames, FEATURE_COUNT), dtype=np.float32)
        padded = np.concatenate([padding, sequence], axis=0)
        windows.append(padded)
        return windows

    # Create overlapping windows
    for start in range(0, n_frames - WINDOW_SIZE + 1, STRIDE):
        window = sequence[start:start + WINDOW_SIZE]
        windows.append(window)

    return windows


def process_landmarks_file(
    landmarks_file: Path,
    split_file: Path,  # Not used - kept for API compatibility
    class_mapping: Dict[int, str],
    vocabulary: List[str],
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Process a landmarks JSON file.

    The file format is: {class_id: [samples...]}
    where each sample has 'keyframes' and 'landmarks'.

    Returns:
        X: (samples, WINDOW_SIZE, FEATURE_COUNT)
        y: (samples,)
    """
    # Load landmarks
    print(f"Loading {landmarks_file.name}...")
    with open(landmarks_file, 'r') as f:
        landmarks_data = json.load(f)

    # Create label mapping
    label_to_idx = {name: idx for idx, name in enumerate(vocabulary)}

    X_list = []
    y_list = []
    skipped_classes = 0
    processed_classes = 0

    # Keys are class IDs, values are lists of samples
    for class_id_str, samples in tqdm(landmarks_data.items(), desc="Processing"):
        class_id = int(class_id_str)

        # Get class name from mapping
        class_name = class_mapping.get(class_id)
        if class_name is None:
            skipped_classes += 1
            continue

        if class_name not in label_to_idx:
            skipped_classes += 1
            continue

        label_idx = label_to_idx[class_name]
        processed_classes += 1

        for sample in samples:
            landmarks = sample.get('landmarks', {})
            keyframes = sample.get('keyframes', 0)

            if keyframes == 0:
                continue

            # Extract sequence
            sequence = []
            for frame_idx in range(keyframes):
                frame_key = str(frame_idx)
                if frame_key in landmarks:
                    frame_features = extract_hand_landmarks(landmarks[frame_key])
                    sequence.append(frame_features)

            if len(sequence) < 4:  # Too short
                continue

            sequence = np.array(sequence, dtype=np.float32)

            # Normalize
            sequence = normalize_landmarks(sequence)

            # Create windows
            windows = create_windows(sequence)

            for window in windows:
                X_list.append(window)
                y_list.append(label_idx)

    print(f"  Processed {processed_classes} classes, skipped {skipped_classes}")

    if len(X_list) == 0:
        return np.array([]), np.array([])

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)

    return X, y


def main():
    parser = argparse.ArgumentParser(
        description='Convert WLASL landmarks to training format'
    )
    parser.add_argument(
        '--input', type=str, default='./data/wlasl_landmarks',
        help='Input directory with WLASL landmarks'
    )
    parser.add_argument(
        '--output', type=str, default='./data/processed',
        help='Output directory for processed data'
    )
    parser.add_argument(
        '--max-classes', type=int, default=25,
        help='Maximum number of classes to use (default: 25 for WLASL-25)'
    )
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"Error: Input directory not found: {input_dir}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("WLASL Landmarks → CNN-LSTM Training Data")
    print("=" * 60)
    print(f"Input: {input_dir}")
    print(f"Output: {output_dir}")
    print(f"Window size: {WINDOW_SIZE} frames")
    print(f"Features: {FEATURE_COUNT} (single hand)")
    print(f"Max classes: {args.max_classes}")

    # Load class mapping
    classes_file = input_dir / 'top_100_classes.txt'
    class_mapping = load_class_mapping(classes_file)
    print(f"\nLoaded {len(class_mapping)} class mappings")

    # Select top N classes
    vocabulary = list(class_mapping.values())[:args.max_classes]
    print(f"Using {len(vocabulary)} classes: {vocabulary[:10]}...")

    # Process each split
    splits = {
        'train': ('wasl100_landmarks_train.json', 'train_100.json'),
        'val': ('wasl100_landmarks_val.json', 'val_100.json'),
        'test': ('wasl100_landmarks_test.json', 'test_100.json'),
    }

    stats = {}

    for split_name, (landmarks_file, split_file) in splits.items():
        landmarks_path = input_dir / landmarks_file
        split_path = input_dir / split_file

        if not landmarks_path.exists():
            print(f"\nSkipping {split_name}: {landmarks_file} not found")
            continue

        print(f"\nProcessing {split_name}...")
        X, y = process_landmarks_file(
            landmarks_path, split_path, class_mapping, vocabulary
        )

        if len(X) == 0:
            print(f"  Warning: No samples for {split_name}")
            continue

        # Shuffle training data
        if split_name == 'train':
            indices = np.random.permutation(len(X))
            X = X[indices]
            y = y[indices]

        # Save
        np.save(output_dir / f'X_{split_name}.npy', X)
        np.save(output_dir / f'y_{split_name}.npy', y)

        stats[split_name] = {
            'n_samples': len(X),
            'shape': list(X.shape),
        }

        print(f"  {split_name}: {X.shape[0]} samples, shape {X.shape}")

    # Save metadata
    metadata = {
        'vocabulary': vocabulary,
        'label_to_idx': {name: idx for idx, name in enumerate(vocabulary)},
        'window_size': WINDOW_SIZE,
        'stride': STRIDE,
        'feature_count': FEATURE_COUNT,
        'single_hand': True,
        'overlapping_windows': True,
        'source': 'WLASL-100-landmarks',
        'stats': stats,
    }

    with open(output_dir / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print("\n" + "=" * 60)
    print("✓ Conversion complete!")
    print(f"Output: {output_dir}")
    print("\nNext steps:")
    print("  1. python train.py --data ./data/processed --epochs 150")
    print("  2. python export_tfjs.py --model ./models/run_cnn_lstm_*/final_model")


if __name__ == '__main__':
    main()
