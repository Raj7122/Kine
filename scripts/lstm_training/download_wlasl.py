#!/usr/bin/env python3
"""
WLASL Dataset Downloader
Downloads videos from the WLASL (Word-Level American Sign Language) dataset.

WLASL is available at: https://github.com/dxli94/WLASL

Usage:
    python download_wlasl.py --output ./data/wlasl --vocab-size 25
"""

import argparse
import json
import os
import time
from pathlib import Path
from typing import List, Dict, Optional
import requests
from tqdm import tqdm
import subprocess

# WLASL-25 Vocabulary (common dynamic signs)
WLASL_25_VOCABULARY = [
    'hello', 'goodbye', 'please', 'thank you', 'sorry',
    'want', 'need', 'help', 'like', 'understand',
    'what', 'where', 'who', 'when', 'why', 'how',
    'yes', 'no', 'maybe', 'good', 'bad',
    'I', 'you', 'name', 'finish',
]

# WLASL JSON URLs (official GitHub)
WLASL_JSON_URL = "https://raw.githubusercontent.com/dxli94/WLASL/master/start_kit/WLASL_v0.3.json"


def download_file(url: str, output_path: Path, max_retries: int = 3) -> bool:
    """Download a file with retry logic."""
    for attempt in range(max_retries):
        try:
            response = requests.get(url, stream=True, timeout=30)
            response.raise_for_status()

            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"  Retry {attempt + 1}/{max_retries} for {url}: {e}")
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                print(f"  Failed to download {url}: {e}")
                return False
    return False


def download_youtube_video(video_id: str, output_path: Path, start_time: float, end_time: float) -> bool:
    """Download a YouTube video segment using yt-dlp."""
    try:
        # Download the video
        cmd = [
            'yt-dlp',
            f'https://www.youtube.com/watch?v={video_id}',
            '-o', str(output_path.with_suffix('.%(ext)s')),
            '-f', 'best[height<=720]',
            '--no-playlist',
            '--quiet',
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            return False

        # Find the downloaded file and trim it
        for ext in ['.mp4', '.webm', '.mkv']:
            downloaded = output_path.with_suffix(ext)
            if downloaded.exists():
                # Trim to the specific segment
                trimmed_path = output_path.with_suffix('.mp4')
                trim_cmd = [
                    'ffmpeg', '-y',
                    '-ss', str(start_time),
                    '-i', str(downloaded),
                    '-t', str(end_time - start_time),
                    '-c', 'copy',
                    str(trimmed_path),
                    '-loglevel', 'error'
                ]
                subprocess.run(trim_cmd, timeout=60)

                # Remove original if trimmed version exists
                if trimmed_path.exists() and downloaded != trimmed_path:
                    downloaded.unlink()

                return trimmed_path.exists()

        return False
    except subprocess.TimeoutExpired:
        print(f"  Timeout downloading video {video_id}")
        return False
    except Exception as e:
        print(f"  Error downloading {video_id}: {e}")
        return False


def load_wlasl_json(cache_dir: Path) -> Dict:
    """Load or download WLASL JSON metadata."""
    json_path = cache_dir / "WLASL_v0.3.json"

    if not json_path.exists():
        print("Downloading WLASL metadata...")
        os.makedirs(cache_dir, exist_ok=True)
        success = download_file(WLASL_JSON_URL, json_path)
        if not success:
            raise RuntimeError("Failed to download WLASL metadata")

    with open(json_path, 'r') as f:
        return json.load(f)


def filter_vocabulary(wlasl_data: List[Dict], vocab: List[str]) -> Dict[str, List[Dict]]:
    """Filter WLASL data to only include specified vocabulary."""
    vocab_lower = [v.lower() for v in vocab]
    filtered = {}

    for entry in wlasl_data:
        gloss = entry.get('gloss', '').lower()
        if gloss in vocab_lower:
            # Normalize gloss to uppercase with underscores
            normalized = gloss.upper().replace(' ', '_')
            filtered[normalized] = entry.get('instances', [])

    return filtered


def download_videos_for_sign(
    sign: str,
    instances: List[Dict],
    output_dir: Path,
    max_videos: int = 20
) -> int:
    """Download videos for a specific sign."""
    sign_dir = output_dir / sign
    os.makedirs(sign_dir, exist_ok=True)

    downloaded = 0

    for i, instance in enumerate(instances[:max_videos]):
        video_id = instance.get('video_id')
        url = instance.get('url', '')

        if not video_id and not url:
            continue

        output_path = sign_dir / f"{sign}_{i:04d}"
        final_path = output_path.with_suffix('.mp4')

        # Skip if already downloaded
        if final_path.exists():
            downloaded += 1
            continue

        # Try YouTube download first
        if video_id and 'youtube' in url.lower():
            start_time = instance.get('start_time', 0)
            end_time = instance.get('end_time', start_time + 5)

            if download_youtube_video(video_id, output_path, start_time, end_time):
                downloaded += 1
                continue

        # Try direct URL download
        if url and (url.endswith('.mp4') or url.endswith('.webm')):
            if download_file(url, final_path):
                downloaded += 1

    return downloaded


def main():
    parser = argparse.ArgumentParser(description='Download WLASL dataset')
    parser.add_argument('--output', type=str, default='./data/wlasl',
                        help='Output directory for downloaded videos')
    parser.add_argument('--vocab-size', type=int, default=25,
                        help='Vocabulary size (25, 100, 300, 1000, 2000)')
    parser.add_argument('--max-videos', type=int, default=20,
                        help='Maximum videos per sign')
    parser.add_argument('--cache-dir', type=str, default='./cache',
                        help='Cache directory for metadata')
    args = parser.parse_args()

    output_dir = Path(args.output)
    cache_dir = Path(args.cache_dir)

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    # Load WLASL metadata
    print("Loading WLASL metadata...")
    wlasl_data = load_wlasl_json(cache_dir)

    # Select vocabulary based on size
    if args.vocab_size <= 25:
        vocab = WLASL_25_VOCABULARY
    else:
        # For larger vocabularies, use all available up to the limit
        vocab = [entry['gloss'] for entry in wlasl_data[:args.vocab_size]]

    print(f"Target vocabulary: {len(vocab)} signs")

    # Filter to target vocabulary
    filtered_data = filter_vocabulary(wlasl_data, vocab)
    print(f"Found {len(filtered_data)} matching signs in WLASL")

    # Download videos
    total_downloaded = 0

    for sign, instances in tqdm(filtered_data.items(), desc="Downloading signs"):
        n_videos = len(instances)
        downloaded = download_videos_for_sign(
            sign, instances, output_dir, args.max_videos
        )
        total_downloaded += downloaded
        tqdm.write(f"  {sign}: {downloaded}/{min(n_videos, args.max_videos)} videos")

    print(f"\nDownload complete! Total videos: {total_downloaded}")
    print(f"Videos saved to: {output_dir}")

    # Save vocabulary mapping
    vocab_path = output_dir / "vocabulary.json"
    with open(vocab_path, 'w') as f:
        json.dump({
            'vocabulary': list(filtered_data.keys()),
            'vocab_size': len(filtered_data),
            'max_videos_per_sign': args.max_videos,
        }, f, indent=2)

    print(f"Vocabulary saved to: {vocab_path}")


if __name__ == '__main__':
    main()
