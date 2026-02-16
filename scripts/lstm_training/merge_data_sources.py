#!/usr/bin/env python3
"""
Merge existing landmark folders from multiple sources (Kaggle/WLASL)
into unified splits.json + vocabulary.json for preprocess.py.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

import numpy as np

PREFERRED_VOCAB_ORDER = [
    'HELLO', 'PLEASE', 'THANK_YOU', 'LIKE', 'WHERE',
    'WHO', 'WHY', 'YES', 'NO', 'BAD', 'FINISH',
    'GOODBYE', 'GOOD', 'NEED', 'CLEAN', 'FOOD',
    'DRINK', 'WATER', 'BATHROOM',
    'SORRY', 'HELP', 'UNDERSTAND', 'WANT', 'NAME',
    'WHAT', 'WHEN', 'HOW', 'MEET', 'AGAIN',
]


def build_vocabulary(sign_dirs: List[str]) -> List[str]:
    known = [sign for sign in PREFERRED_VOCAB_ORDER if sign in sign_dirs]
    unknown = sorted([sign for sign in sign_dirs if sign not in PREFERRED_VOCAB_ORDER])
    return known + unknown


def collect_records(landmarks_dir: Path, vocabulary: List[str]) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []
    for sign in vocabulary:
        sign_dir = landmarks_dir / sign
        if not sign_dir.exists():
            continue

        for sample_path in sorted(sign_dir.glob('*.npy')):
            records.append({
                'sign': sign,
                'path': str(sample_path.relative_to(landmarks_dir)),
            })

    return records


def create_sign_stratified_splits(
    records: List[Dict[str, str]],
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> Dict[str, List[Dict[str, str]]]:
    rng = np.random.default_rng(seed)
    grouped: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    for record in records:
        grouped[record['sign']].append(record)

    splits = {'train': [], 'val': [], 'test': []}

    for sign, items in grouped.items():
        indices = np.arange(len(items))
        rng.shuffle(indices)
        shuffled = [items[i] for i in indices]

        n = len(shuffled)
        if n == 1:
            splits['train'].append({'sign': sign, 'path': shuffled[0]['path']})
            continue

        n_train = max(1, int(n * train_ratio))
        n_val = int(n * val_ratio)

        if n >= 3:
            n_val = max(1, n_val)
        n_val = min(n_val, max(0, n - n_train - 1))
        n_test = n - n_train - n_val

        if n_test == 0 and n > 1:
            if n_val > 0:
                n_val -= 1
            elif n_train > 1:
                n_train -= 1
            n_test = n - n_train - n_val

        train_items = shuffled[:n_train]
        val_items = shuffled[n_train:n_train + n_val]
        test_items = shuffled[n_train + n_val:]

        splits['train'].extend({'sign': sign, 'path': sample['path']} for sample in train_items)
        splits['val'].extend({'sign': sign, 'path': sample['path']} for sample in val_items)
        splits['test'].extend({'sign': sign, 'path': sample['path']} for sample in test_items)

    return splits


def main() -> None:
    parser = argparse.ArgumentParser(description='Merge Kaggle + WLASL landmarks into unified splits/vocabulary')
    parser.add_argument('--landmarks-dir', default='./data/landmarks', help='Directory containing <SIGN>/*.npy folders')
    parser.add_argument('--train-ratio', type=float, default=0.8, help='Train split ratio')
    parser.add_argument('--val-ratio', type=float, default=0.1, help='Validation split ratio')
    parser.add_argument('--seed', type=int, default=42, help='Random seed')
    args = parser.parse_args()

    landmarks_dir = Path(args.landmarks_dir)
    if not landmarks_dir.exists():
        raise FileNotFoundError(f'Landmarks directory not found: {landmarks_dir}')

    sign_dirs = sorted([entry.name for entry in landmarks_dir.iterdir() if entry.is_dir()])
    if not sign_dirs:
        raise RuntimeError(f'No sign directories found in {landmarks_dir}')

    vocabulary = build_vocabulary(sign_dirs)
    records = collect_records(landmarks_dir, vocabulary)
    if not records:
        raise RuntimeError(f'No .npy samples found under {landmarks_dir}')

    splits = create_sign_stratified_splits(
        records,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )

    (landmarks_dir / 'splits.json').write_text(json.dumps(splits, indent=2), encoding='utf-8')
    (landmarks_dir / 'vocabulary.json').write_text(
        json.dumps({'vocabulary': vocabulary}, indent=2),
        encoding='utf-8',
    )

    stats = {
        'landmarks_dir': str(landmarks_dir),
        'total_signs': len(vocabulary),
        'total_samples': len(records),
        'split_counts': {name: len(items) for name, items in splits.items()},
    }
    (landmarks_dir / 'merge_stats.json').write_text(json.dumps(stats, indent=2), encoding='utf-8')

    print('[MergeDataSources] Complete')
    print(f"  Signs: {stats['total_signs']}")
    print(f"  Samples: {stats['total_samples']}")
    print(
        '  Splits: '
        f"train={stats['split_counts']['train']}, "
        f"val={stats['split_counts']['val']}, "
        f"test={stats['split_counts']['test']}"
    )


if __name__ == '__main__':
    main()
