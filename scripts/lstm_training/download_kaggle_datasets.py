#!/usr/bin/env python3
"""
Download Pre-Processed ASL Datasets from Kaggle

Supports two datasets:
1. WLASL Processed - 21,083 video clips with landmarks
2. Sign Language for LSTM - Pre-formatted for temporal modeling

Prerequisites:
    pip install kaggle
    # Set up ~/.kaggle/kaggle.json with your API key
    # Get key from: https://www.kaggle.com/settings → API → Create New Token

Usage:
    python download_kaggle_datasets.py --dataset wlasl
    python download_kaggle_datasets.py --dataset lstm-ready
    python download_kaggle_datasets.py --dataset both
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


# Kaggle dataset identifiers
DATASETS = {
    'wlasl': {
        'id': 'risangbaskoro/wlasl-processed',  # WLASL processed dataset
        'description': 'WLASL Processed - 21,083 video clips',
        'output_dir': 'wlasl_processed',
    },
    'lstm-ready': {
        'id': 'prathumarikeri/sign-language-for-lstm',  # Sign Language for LSTM
        'description': 'Sign Language for LSTM - Pre-formatted sequences',
        'output_dir': 'lstm_ready',
    },
}


def check_kaggle_cli():
    """Check if Kaggle CLI is installed and configured."""
    try:
        result = subprocess.run(
            ['kaggle', '--version'],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise Exception("Kaggle CLI not working")
        print(f"✓ Kaggle CLI: {result.stdout.strip()}")
        return True
    except FileNotFoundError:
        print("✗ Kaggle CLI not found")
        print("  Install with: pip install kaggle")
        return False
    except Exception as e:
        print(f"✗ Kaggle CLI error: {e}")
        return False


def check_kaggle_auth():
    """Check if Kaggle API credentials are configured."""
    kaggle_json = Path.home() / '.kaggle' / 'kaggle.json'

    if kaggle_json.exists():
        print(f"✓ Kaggle credentials found: {kaggle_json}")
        return True

    # Check environment variables
    if os.environ.get('KAGGLE_USERNAME') and os.environ.get('KAGGLE_KEY'):
        print("✓ Kaggle credentials found in environment variables")
        return True

    print("✗ Kaggle credentials not found")
    print("  Option 1: Create ~/.kaggle/kaggle.json")
    print("           Go to https://www.kaggle.com/settings → API → Create New Token")
    print("  Option 2: Set KAGGLE_USERNAME and KAGGLE_KEY environment variables")
    return False


def download_dataset(dataset_key: str, data_dir: Path):
    """Download a dataset from Kaggle."""
    if dataset_key not in DATASETS:
        print(f"Unknown dataset: {dataset_key}")
        print(f"Available: {list(DATASETS.keys())}")
        return False

    config = DATASETS[dataset_key]
    output_dir = data_dir / config['output_dir']

    print(f"\n{'='*60}")
    print(f"Downloading: {config['description']}")
    print(f"Dataset ID: {config['id']}")
    print(f"Output: {output_dir}")
    print('='*60)

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Download using Kaggle CLI
    cmd = [
        'kaggle', 'datasets', 'download',
        '-d', config['id'],
        '-p', str(output_dir),
        '--unzip',
    ]

    print(f"\nRunning: {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Error: {result.stderr}")
            return False

        print(result.stdout)
        print(f"\n✓ Downloaded to: {output_dir}")

        # List contents
        print("\nContents:")
        for item in sorted(output_dir.iterdir()):
            if item.is_dir():
                file_count = len(list(item.rglob('*')))
                print(f"  📁 {item.name}/ ({file_count} files)")
            else:
                size_mb = item.stat().st_size / (1024 * 1024)
                print(f"  📄 {item.name} ({size_mb:.1f} MB)")

        return True

    except Exception as e:
        print(f"Download failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Download pre-processed ASL datasets from Kaggle'
    )
    parser.add_argument(
        '--dataset',
        type=str,
        choices=['wlasl', 'lstm-ready', 'both'],
        default='lstm-ready',
        help='Dataset to download (default: lstm-ready for faster training)'
    )
    parser.add_argument(
        '--data-dir',
        type=str,
        default='./data',
        help='Directory to save datasets (default: ./data)'
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir)

    print("Kaggle Dataset Downloader for ASL Recognition")
    print("=" * 60)

    # Check prerequisites
    if not check_kaggle_cli():
        print("\nInstall Kaggle CLI first:")
        print("  pip install kaggle")
        sys.exit(1)

    if not check_kaggle_auth():
        print("\nSet up Kaggle authentication first")
        sys.exit(1)

    # Download requested datasets
    success = True

    if args.dataset == 'both':
        for key in DATASETS:
            if not download_dataset(key, data_dir):
                success = False
    else:
        success = download_dataset(args.dataset, data_dir)

    if success:
        print("\n" + "=" * 60)
        print("✓ Download complete!")
        print("\nNext steps:")
        print("  1. Run: python prepare_kaggle_data.py --dataset " + args.dataset)
        print("  2. Run: python train.py --data ./data/processed")
        print("  3. Run: python export_tfjs.py")
    else:
        print("\n✗ Some downloads failed")
        sys.exit(1)


if __name__ == '__main__':
    main()
