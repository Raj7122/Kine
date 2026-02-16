#!/usr/bin/env python3
"""
Prepare Google Isolated ASL (Kaggle) dataset for Kine's Kaggle-target LSTM pipeline.

Output format matches preprocess.py expectations:
  <output>/
    <SIGN>/sample.npy
    splits.json
    vocabulary.json
    prepare_stats.json

Usage:
  python prepare_kaggle_data.py --output ./data/landmarks --download
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import numpy as np
import pandas as pd
import requests
from tqdm import tqdm


TARGET_VOCABULARY = [
    # Existing 11-sign model order first
    'HELLO', 'PLEASE', 'THANK_YOU', 'LIKE', 'WHERE',
    'WHO', 'WHY', 'YES', 'NO', 'BAD', 'FINISH',
    # Kaggle-available expansion signs
    'GOODBYE', 'GOOD', 'NEED', 'CLEAN', 'FOOD',
    'DRINK', 'WATER', 'BATHROOM',
]


def normalize_sign_token(value: str) -> str:
    value = value.strip().upper()
    value = re.sub(r'[^A-Z0-9]+', '_', value)
    return value.strip('_')


def canonical_sign_key(value: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', normalize_sign_token(value))


def build_target_lookup(vocabulary: List[str]) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for sign in vocabulary:
        lookup[canonical_sign_key(sign)] = sign

    # Common aliases
    aliases = {
        'THANKYOU': 'THANK_YOU',
        'BYE': 'GOODBYE',
        'FINE': 'GOOD',
        'HAVETO': 'NEED',
        'POTTY': 'BATHROOM',
    }
    for alias_key, canonical in aliases.items():
        if canonical in vocabulary:
            lookup[alias_key] = canonical

    return lookup


def map_sign_to_target(raw_sign: str, lookup: Dict[str, str]) -> Optional[str]:
    return lookup.get(canonical_sign_key(raw_sign))


def safe_slug(value: str) -> str:
    slug = re.sub(r'[^a-zA-Z0-9_-]+', '_', str(value).strip())
    return slug.strip('_') or 'unknown'


def has_kaggle_credentials() -> bool:
    env_ok = bool(os.getenv('KAGGLE_USERNAME') and os.getenv('KAGGLE_KEY'))
    token_ok = bool(os.getenv('KAGGLE_API_TOKEN'))
    file_ok = Path.home().joinpath('.kaggle', 'kaggle.json').exists()
    return env_ok or token_ok or file_ok


def run_command(cmd: List[str], cwd: Optional[Path] = None) -> None:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({' '.join(cmd)}):\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )


def download_competition_archive_with_token(competition: str, cache_dir: Path) -> Path:
    """Download Kaggle competition archive using bearer auth token."""
    token = os.getenv('KAGGLE_API_TOKEN')
    if not token:
        raise RuntimeError('KAGGLE_API_TOKEN is not set')

    archive_path = cache_dir / f'{competition}.zip'
    url = f'https://www.kaggle.com/api/v1/competitions/data/download-all/{competition}'
    headers = {'Authorization': f'Bearer {token}'}

    with requests.get(url, headers=headers, stream=True, allow_redirects=True, timeout=(30, 300)) as response:
        response.raise_for_status()

        total_bytes = int(response.headers.get('Content-Length', 0) or 0)
        progress = None
        if total_bytes > 0:
            progress = tqdm(total=total_bytes, unit='B', unit_scale=True, desc='Downloading Kaggle archive')

        with open(archive_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                if progress is not None:
                    progress.update(len(chunk))

        if progress is not None:
            progress.close()

    if not archive_path.exists() or archive_path.stat().st_size == 0:
        raise RuntimeError(f'Failed to download Kaggle archive to {archive_path}')

    return archive_path


def download_competition_file_with_token(
    competition: str,
    token: str,
    remote_path: str,
    local_path: Path,
) -> None:
    """Download a single competition file via bearer token auth."""
    encoded_path = quote(remote_path.lstrip('/'), safe='')
    url = f'https://www.kaggle.com/api/v1/competitions/data/download/{competition}/{encoded_path}'
    headers = {'Authorization': f'Bearer {token}'}

    local_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_path = local_path.with_suffix(local_path.suffix + '.download')

    with requests.get(url, headers=headers, stream=True, allow_redirects=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        with open(tmp_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)

    if zipfile.is_zipfile(tmp_path):
        with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
            members = [name for name in zip_ref.namelist() if not name.endswith('/')]
            if not members:
                raise RuntimeError(f'Empty zip payload received for {remote_path}')

            preferred = next((m for m in members if Path(m).name == local_path.name), members[0])
            with zip_ref.open(preferred) as src, open(local_path, 'wb') as dst:
                shutil.copyfileobj(src, dst)
        tmp_path.unlink(missing_ok=True)
    else:
        tmp_path.replace(local_path)


def download_kaggle_subset_with_token(
    competition: str,
    dataset_dir: Path,
    target_lookup: Dict[str, str],
    max_per_sign: int,
) -> None:
    """
    Download only train.csv + selected parquet files for target vocabulary.

    This avoids pulling the full ~40GB archive when disk space is limited.
    """
    token = os.getenv('KAGGLE_API_TOKEN')
    if not token:
        raise RuntimeError('KAGGLE_API_TOKEN is not set')

    train_csv_path = dataset_dir / 'train.csv'
    if not train_csv_path.exists():
        print('[Kaggle] Downloading train.csv')
        download_competition_file_with_token(competition, token, 'train.csv', train_csv_path)

    sign_map_path = dataset_dir / 'sign_to_prediction_index_map.json'
    if not sign_map_path.exists():
        try:
            download_competition_file_with_token(
                competition,
                token,
                'sign_to_prediction_index_map.json',
                sign_map_path,
            )
        except Exception as exc:
            print(f"[Kaggle] Warning: could not download sign_to_prediction_index_map.json ({exc})")

    df = pd.read_csv(train_csv_path)
    sign_col = resolve_column(df, ['sign', 'label', 'gloss'])
    path_col = resolve_column(df, ['path', 'parquet_path', 'file_path'])

    if sign_col is None or path_col is None:
        raise RuntimeError(
            f"Could not find required columns in train.csv. Available columns: {list(df.columns)}"
        )

    per_sign_counter: Counter[str] = Counter()
    selected_paths: List[str] = []

    for row in df.itertuples(index=False):
        row_dict = row._asdict()
        mapped_sign = map_sign_to_target(str(row_dict.get(sign_col, '')), target_lookup)
        if not mapped_sign:
            continue

        if max_per_sign > 0 and per_sign_counter[mapped_sign] >= max_per_sign:
            continue

        rel_path = str(row_dict.get(path_col, '')).strip()
        if not rel_path:
            continue

        selected_paths.append(rel_path)
        per_sign_counter[mapped_sign] += 1

    unique_paths = sorted(set(selected_paths))
    if not unique_paths:
        raise RuntimeError('No target parquet files selected from train.csv for requested vocabulary')

    print(f"[Kaggle] Downloading {len(unique_paths)} parquet files for target vocabulary")
    failures = 0
    for rel_path in tqdm(unique_paths, desc='Downloading Kaggle parquet files'):
        local_path = dataset_dir / rel_path
        if local_path.exists():
            continue

        try:
            download_competition_file_with_token(competition, token, rel_path, local_path)
            continue
        except Exception:
            pass

        fallback_rel = f"train_landmark_files/{rel_path.lstrip('/')}"
        if fallback_rel != rel_path:
            try:
                download_competition_file_with_token(competition, token, fallback_rel, local_path)
                continue
            except Exception:
                pass

        failures += 1

    if failures:
        print(f"[Kaggle] Warning: failed to download {failures} selected parquet file(s)")


def download_kaggle_competition(
    competition: str,
    cache_dir: Path,
    dataset_dir: Path,
    target_lookup: Optional[Dict[str, str]] = None,
    max_per_sign: int = 0,
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    dataset_dir.mkdir(parents=True, exist_ok=True)

    existing_train_csv = list(dataset_dir.rglob('train.csv'))
    if existing_train_csv:
        existing_parquet = list(dataset_dir.rglob('*.parquet'))
        if existing_parquet:
            print(f"[Kaggle] Existing extracted dataset found at: {dataset_dir}")
            return
        print(f"[Kaggle] train.csv exists but parquet files are missing; continuing download at: {dataset_dir}")

    if not has_kaggle_credentials():
        raise RuntimeError(
            'Kaggle credentials not found. Set KAGGLE_USERNAME/KAGGLE_KEY, KAGGLE_API_TOKEN, or place kaggle.json in ~/.kaggle/'
        )

    zip_files: List[Path] = []
    if os.getenv('KAGGLE_API_TOKEN') and target_lookup is not None:
        print(f"[Kaggle] Downloading selected competition files with KAGGLE_API_TOKEN: {competition}")
        download_kaggle_subset_with_token(
            competition=competition,
            dataset_dir=dataset_dir,
            target_lookup=target_lookup,
            max_per_sign=max_per_sign,
        )
        return
    elif os.getenv('KAGGLE_API_TOKEN'):
        print(f"[Kaggle] Downloading full competition archive with KAGGLE_API_TOKEN: {competition}")
        archive = download_competition_archive_with_token(competition, cache_dir)
        zip_files = [archive]
    else:
        print(f"[Kaggle] Downloading competition dataset with Kaggle CLI: {competition}")
        run_command([
            'kaggle',
            'competitions',
            'download',
            '-c',
            competition,
            '-p',
            str(cache_dir),
        ])

        zip_files = sorted(cache_dir.glob('*.zip'))

    if not zip_files:
        raise RuntimeError(f'No zip files found in {cache_dir} after download')

    print(f"[Kaggle] Extracting {len(zip_files)} archive(s) to {dataset_dir}")
    for zip_path in zip_files:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(dataset_dir)


def find_dataset_files(dataset_dir: Path) -> Tuple[Path, Path]:
    train_csv_candidates = sorted(dataset_dir.rglob('train.csv'))
    if not train_csv_candidates:
        raise FileNotFoundError(
            f"Could not find train.csv under {dataset_dir}. Ensure Kaggle dataset is extracted."
        )

    train_csv = train_csv_candidates[0]
    dataset_root = train_csv.parent
    return train_csv, dataset_root


def resolve_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    lowered = {c.lower(): c for c in df.columns}
    for candidate in candidates:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    return None


def infer_frame_column(df: pd.DataFrame) -> Optional[str]:
    for candidate in ('frame', 'frame_id', 'frame_index'):
        if candidate in df.columns:
            return candidate

    if 'row_id' in df.columns:
        extracted = df['row_id'].astype(str).str.extract(r'(\d+)$')[0]
        if extracted.notna().any():
            df['__frame__'] = pd.to_numeric(extracted, errors='coerce')
            return '__frame__'

    return None


def hand_offset_from_type(hand_type: str) -> Optional[int]:
    t = hand_type.lower()
    if 'left_hand' in t or t == 'left':
        return 0
    if 'right_hand' in t or t == 'right':
        return 63
    return None


def parquet_to_sequence(parquet_path: Path) -> Optional[np.ndarray]:
    df = pd.read_parquet(parquet_path)
    if df.empty:
        return None

    type_col = resolve_column(df, ['type'])
    idx_col = resolve_column(df, ['landmark_index', 'landmark_id', 'index'])
    x_col = resolve_column(df, ['x'])
    y_col = resolve_column(df, ['y'])
    z_col = resolve_column(df, ['z'])
    frame_col = infer_frame_column(df)

    required = [type_col, idx_col, x_col, y_col, z_col, frame_col]
    if any(col is None for col in required):
        return None

    working = df[[frame_col, type_col, idx_col, x_col, y_col, z_col]].copy()
    working[frame_col] = pd.to_numeric(working[frame_col], errors='coerce')
    working[idx_col] = pd.to_numeric(working[idx_col], errors='coerce')
    working[x_col] = pd.to_numeric(working[x_col], errors='coerce')
    working[y_col] = pd.to_numeric(working[y_col], errors='coerce')
    working[z_col] = pd.to_numeric(working[z_col], errors='coerce')

    working = working.dropna(subset=[frame_col, idx_col])
    if working.empty:
        return None

    working[frame_col] = working[frame_col].astype(np.int32)
    working[idx_col] = working[idx_col].astype(np.int32)
    working = working[(working[frame_col] >= 0) & (working[idx_col] >= 0) & (working[idx_col] < 21)]
    if working.empty:
        return None

    min_frame = int(working[frame_col].min())
    working[frame_col] = working[frame_col] - min_frame

    n_frames = int(working[frame_col].max()) + 1
    sequence = np.zeros((n_frames, 126), dtype=np.float32)

    for frame, hand_type, landmark_idx, x, y, z in working.itertuples(index=False, name=None):
        offset = hand_offset_from_type(str(hand_type))
        if offset is None:
            continue
        base = offset + int(landmark_idx) * 3
        sequence[int(frame), base] = 0.0 if pd.isna(x) else float(x)
        sequence[int(frame), base + 1] = 0.0 if pd.isna(y) else float(y)
        sequence[int(frame), base + 2] = 0.0 if pd.isna(z) else float(z)

    non_zero_mask = np.any(sequence != 0, axis=1)
    if not np.any(non_zero_mask):
        return None

    first = int(np.argmax(non_zero_mask))
    last = int(len(non_zero_mask) - 1 - np.argmax(non_zero_mask[::-1]))
    trimmed = sequence[first:last + 1]
    return trimmed


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

        splits['train'].extend({'sign': sign, 'path': r['path']} for r in train_items)
        splits['val'].extend({'sign': sign, 'path': r['path']} for r in val_items)
        splits['test'].extend({'sign': sign, 'path': r['path']} for r in test_items)

    return splits


def create_participant_splits(
    records: List[Dict[str, str]],
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> Optional[Dict[str, List[Dict[str, str]]]]:
    participants = sorted({r['participant'] for r in records if r['participant'] != 'unknown'})
    if len(participants) < 6:
        return None

    rng = np.random.default_rng(seed)
    participants = list(rng.permutation(participants))

    n = len(participants)
    n_train = max(1, int(n * train_ratio))
    n_val = max(1, int(n * val_ratio))
    if n_train + n_val >= n:
        n_val = max(1, n - n_train - 1)
    n_test = n - n_train - n_val
    if n_test <= 0:
        return None

    train_p = set(participants[:n_train])
    val_p = set(participants[n_train:n_train + n_val])
    test_p = set(participants[n_train + n_val:])

    splits = {'train': [], 'val': [], 'test': []}
    for record in records:
        entry = {'sign': record['sign'], 'path': record['path']}
        participant = record['participant']
        if participant in train_p:
            splits['train'].append(entry)
        elif participant in val_p:
            splits['val'].append(entry)
        elif participant in test_p:
            splits['test'].append(entry)
        else:
            splits['train'].append(entry)

    if not splits['train'] or not splits['val'] or not splits['test']:
        return None

    train_signs = {e['sign'] for e in splits['train']}
    all_signs = {r['sign'] for r in records}
    if train_signs != all_signs:
        return None

    return splits


def prepare_dataset(
    df: pd.DataFrame,
    dataset_root: Path,
    output_dir: Path,
    sign_col: str,
    path_col: str,
    participant_col: Optional[str],
    sequence_col: Optional[str],
    target_lookup: Dict[str, str],
    max_per_sign: int,
    min_nonzero_frames: int,
) -> Tuple[List[Dict[str, str]], Dict[str, Any]]:
    output_dir.mkdir(parents=True, exist_ok=True)

    per_sign_counter: Counter[str] = Counter()
    records: List[Dict[str, str]] = []

    stats: Dict[str, Any] = {
        'rows_total': int(len(df)),
        'rows_matched_vocab': 0,
        'saved_sequences': 0,
        'skipped_no_match': 0,
        'skipped_max_per_sign': 0,
        'skipped_missing_parquet': 0,
        'skipped_parse_failure': 0,
        'skipped_too_short': 0,
        'samples_per_sign': {},
    }

    for row in tqdm(df.itertuples(index=False), total=len(df), desc='Converting Kaggle samples'):
        row_dict = row._asdict()

        raw_sign = str(row_dict.get(sign_col, ''))
        mapped_sign = map_sign_to_target(raw_sign, target_lookup)
        if not mapped_sign:
            stats['skipped_no_match'] += 1
            continue

        stats['rows_matched_vocab'] += 1

        if max_per_sign > 0 and per_sign_counter[mapped_sign] >= max_per_sign:
            stats['skipped_max_per_sign'] += 1
            continue

        rel_parquet = str(row_dict.get(path_col, '')).strip()
        parquet_path = dataset_root / rel_parquet
        if not parquet_path.exists():
            # Common fallback if path does not include train_landmark_files prefix.
            fallback = dataset_root / 'train_landmark_files' / rel_parquet
            parquet_path = fallback if fallback.exists() else parquet_path

        if not parquet_path.exists():
            stats['skipped_missing_parquet'] += 1
            continue

        try:
            sequence = parquet_to_sequence(parquet_path)
        except Exception:
            stats['skipped_parse_failure'] += 1
            continue

        if sequence is None:
            stats['skipped_parse_failure'] += 1
            continue

        non_zero_frames = int(np.sum(np.any(sequence != 0, axis=1)))
        if non_zero_frames < min_nonzero_frames:
            stats['skipped_too_short'] += 1
            continue

        sign_dir = output_dir / mapped_sign
        sign_dir.mkdir(parents=True, exist_ok=True)

        participant_value = row_dict.get(participant_col, 'unknown') if participant_col else 'unknown'
        participant = safe_slug(participant_value)
        sequence_value = row_dict.get(sequence_col, Path(rel_parquet).stem) if sequence_col else Path(rel_parquet).stem
        sequence_id = safe_slug(sequence_value)

        filename = f"{participant}_{sequence_id}.npy"
        file_path = sign_dir / filename

        dedupe_idx = 1
        while file_path.exists():
            filename = f"{participant}_{sequence_id}_{dedupe_idx}.npy"
            file_path = sign_dir / filename
            dedupe_idx += 1

        np.save(file_path, sequence.astype(np.float32))

        rel_output = str(file_path.relative_to(output_dir))
        records.append({
            'sign': mapped_sign,
            'path': rel_output,
            'participant': participant,
        })

        per_sign_counter[mapped_sign] += 1
        stats['saved_sequences'] += 1

    stats['samples_per_sign'] = dict(sorted(per_sign_counter.items()))
    return records, stats


def load_custom_vocabulary(vocabulary_file: Optional[Path]) -> List[str]:
    if not vocabulary_file:
        return TARGET_VOCABULARY

    with open(vocabulary_file, 'r', encoding='utf-8') as f:
        content = json.load(f)

    if not isinstance(content, list) or not all(isinstance(item, str) for item in content):
        raise ValueError('vocabulary file must be a JSON array of strings')

    normalized = [normalize_sign_token(item) for item in content]
    return sorted(set(normalized))


def main() -> None:
    parser = argparse.ArgumentParser(description='Prepare Kaggle ASL dataset for Kine LSTM training')
    parser.add_argument('--competition', default='asl-signs', help='Kaggle competition slug')
    parser.add_argument('--download', action='store_true', help='Download competition data using Kaggle CLI')
    parser.add_argument('--dataset-dir', default='./data/kaggle_raw', help='Extracted Kaggle dataset directory')
    parser.add_argument('--cache-dir', default='./cache/kaggle', help='Download cache directory for Kaggle zip files')
    parser.add_argument('--output', default='./data/landmarks', help='Output landmarks directory used by preprocess.py')
    parser.add_argument('--vocabulary-file', default=None, help='Optional JSON file with target vocabulary list')
    parser.add_argument('--max-per-sign', type=int, default=0, help='Max sequences per sign (0 = all)')
    parser.add_argument('--min-nonzero-frames', type=int, default=4, help='Minimum non-empty frames required per sample')
    parser.add_argument('--train-ratio', type=float, default=0.8, help='Train split ratio')
    parser.add_argument('--val-ratio', type=float, default=0.1, help='Validation split ratio')
    parser.add_argument('--seed', type=int, default=42, help='Random seed')
    parser.add_argument('--clean-output', action='store_true', help='Clear existing output directory before preparing')
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    cache_dir = Path(args.cache_dir)
    output_dir = Path(args.output)

    vocabulary = load_custom_vocabulary(Path(args.vocabulary_file) if args.vocabulary_file else None)
    target_lookup = build_target_lookup(vocabulary)

    if args.download:
        download_kaggle_competition(
            args.competition,
            cache_dir,
            dataset_dir,
            target_lookup=target_lookup,
            max_per_sign=args.max_per_sign,
        )

    if not dataset_dir.exists():
        raise FileNotFoundError(
            f"Dataset directory not found: {dataset_dir}. Use --download or provide --dataset-dir."
        )

    train_csv, dataset_root = find_dataset_files(dataset_dir)
    print(f"[Kaggle] train.csv: {train_csv}")

    df = pd.read_csv(train_csv)
    sign_col = resolve_column(df, ['sign', 'label', 'gloss'])
    path_col = resolve_column(df, ['path', 'parquet_path', 'file_path'])
    participant_col = resolve_column(df, ['participant_id', 'participant', 'signer_id'])
    sequence_col = resolve_column(df, ['sequence_id', 'sequence', 'sample_id'])

    if sign_col is None or path_col is None:
        raise RuntimeError(
            f"Could not find required columns in train.csv. Available columns: {list(df.columns)}"
        )

    if args.clean_output and output_dir.exists():
        for child in output_dir.iterdir():
            if child.is_file():
                child.unlink()
            else:
                for nested in child.rglob('*'):
                    if nested.is_file():
                        nested.unlink()
                for nested in sorted(child.rglob('*'), reverse=True):
                    if nested.is_dir():
                        nested.rmdir()
                child.rmdir()

    output_dir.mkdir(parents=True, exist_ok=True)

    records, stats = prepare_dataset(
        df=df,
        dataset_root=dataset_root,
        output_dir=output_dir,
        sign_col=sign_col,
        path_col=path_col,
        participant_col=participant_col,
        sequence_col=sequence_col,
        target_lookup=target_lookup,
        max_per_sign=args.max_per_sign,
        min_nonzero_frames=args.min_nonzero_frames,
    )

    if not records:
        raise RuntimeError('No sequences were prepared. Check vocabulary mapping and dataset paths.')

    participant_splits = create_participant_splits(
        records,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )

    if participant_splits:
        splits = participant_splits
        split_strategy = 'participant'
    else:
        splits = create_sign_stratified_splits(
            records,
            train_ratio=args.train_ratio,
            val_ratio=args.val_ratio,
            seed=args.seed,
        )
        split_strategy = 'sign_stratified'

    with open(output_dir / 'splits.json', 'w', encoding='utf-8') as f:
        json.dump(splits, f, indent=2)

    with open(output_dir / 'vocabulary.json', 'w', encoding='utf-8') as f:
        json.dump({'vocabulary': vocabulary}, f, indent=2)

    split_counts = {k: len(v) for k, v in splits.items()}
    summary = {
        'dataset': 'kaggle_asl_signs',
        'competition': args.competition,
        'train_csv': str(train_csv),
        'dataset_root': str(dataset_root),
        'output_dir': str(output_dir),
        'split_strategy': split_strategy,
        'split_counts': split_counts,
        'vocabulary': vocabulary,
        **stats,
    }

    with open(output_dir / 'prepare_stats.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)

    print('\n[Kaggle] Preparation complete!')
    print(f"  Output dir: {output_dir}")
    print(f"  Split strategy: {split_strategy}")
    print(f"  Saved sequences: {stats['saved_sequences']}")
    print(f"  Split counts: train={split_counts['train']}, val={split_counts['val']}, test={split_counts['test']}")


if __name__ == '__main__':
    main()
