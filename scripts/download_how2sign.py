#!/usr/bin/env python3
"""
Download How2Sign dataset clips for Kine flipbook avatars.

The How2Sign dataset is hosted on Google Drive. This script helps
download specific clips or the full dataset.

Usage:
    python download_how2sign.py --help
    python download_how2sign.py --list          # Show available files
    python download_how2sign.py --sample        # Download a few sample clips
    python download_how2sign.py --all           # Download all clips (large!)

Dataset: https://how2sign.github.io/
License: CC BY-NC 4.0 (Research/Non-commercial use only)
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path

# How2Sign Google Drive file IDs (from their website)
# These are the smaller clip versions, not full videos
HOW2SIGN_FILES = {
    # Green Screen RGB Clips (smaller, easier to process)
    "clips_train": {
        "id": "1BdfBDCy7Kqv8Wz2bqWKfqmPjYXxWNat_",
        "name": "green_screen_rgb_clips_train.zip",
        "size": "31GB",
        "description": "Training clips (frontal view)"
    },
    "clips_val": {
        "id": "1mQ_XHbqMpEaGr0GR5Xjzr8dAnCzqzjXR",
        "name": "green_screen_rgb_clips_val.zip",
        "size": "1.7GB",
        "description": "Validation clips (frontal view)"
    },
    "clips_test": {
        "id": "1YT7Xp9PEqtSQhXTiMBJuVb_RnRZK8T2E",
        "name": "green_screen_rgb_clips_test.zip",
        "size": "2.2GB",
        "description": "Test clips (frontal view)"
    },
    # Annotations (needed to map clips to glosses)
    "annotations": {
        "id": "1dJTbHxP_fTLVVXhJT0z7OU_qWqQRUyLe",
        "name": "how2sign_realigned.csv",
        "size": "5MB",
        "description": "Annotations with gloss labels"
    }
}

# For quick testing, we can use sample videos
SAMPLE_CLIPS = [
    # These would be individual clip IDs if available
    # For now, we'll work with the validation set as it's smallest
]


def check_gdown():
    """Check if gdown is installed for Google Drive downloads."""
    try:
        import gdown
        return True
    except ImportError:
        print("Installing gdown for Google Drive downloads...")
        subprocess.run([sys.executable, "-m", "pip", "install", "gdown"], check=True)
        return True


def download_file(file_id: str, output_path: str, filename: str):
    """Download a file from Google Drive using gdown."""
    import gdown

    url = f"https://drive.google.com/uc?id={file_id}"
    output_file = os.path.join(output_path, filename)

    print(f"Downloading {filename}...")
    gdown.download(url, output_file, quiet=False)

    return output_file


def list_files():
    """List available How2Sign files."""
    print("\nAvailable How2Sign files:\n")
    print(f"{'Key':<15} {'Size':<10} {'Description'}")
    print("-" * 60)
    for key, info in HOW2SIGN_FILES.items():
        print(f"{key:<15} {info['size']:<10} {info['description']}")
    print()
    print("Note: For Kine, we recommend starting with 'clips_val' (1.7GB)")
    print("      and 'annotations' to map clips to gloss labels.")


def download_sample(output_dir: str):
    """Download validation clips (smallest set) for testing."""
    os.makedirs(output_dir, exist_ok=True)

    check_gdown()

    print("\n=== Downloading How2Sign Sample (Validation Set) ===\n")
    print("This will download:")
    print("  - Validation clips (~1.7GB)")
    print("  - Annotations file (~5MB)")
    print(f"\nOutput directory: {output_dir}\n")

    # Download annotations first
    ann_info = HOW2SIGN_FILES["annotations"]
    download_file(ann_info["id"], output_dir, ann_info["name"])

    # Download validation clips
    clips_info = HOW2SIGN_FILES["clips_val"]
    zip_path = download_file(clips_info["id"], output_dir, clips_info["name"])

    # Unzip
    print(f"\nExtracting {clips_info['name']}...")
    subprocess.run(["unzip", "-o", zip_path, "-d", output_dir], check=True)

    print("\n=== Download Complete ===")
    print(f"Clips extracted to: {output_dir}")
    print("\nNext steps:")
    print("  1. Run: python extract_frames.py --input <clips_dir> --output ./frames")
    print("  2. Run: python upload_to_supabase.py --frames ./frames")


def main():
    parser = argparse.ArgumentParser(
        description="Download How2Sign dataset for Kine flipbook avatars"
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List available files"
    )
    parser.add_argument(
        "--sample", "-s",
        action="store_true",
        help="Download validation set sample (~1.7GB)"
    )
    parser.add_argument(
        "--output", "-o",
        default="./how2sign",
        help="Output directory (default: ./how2sign)"
    )
    parser.add_argument(
        "--file", "-f",
        choices=list(HOW2SIGN_FILES.keys()),
        help="Download a specific file"
    )

    args = parser.parse_args()

    if args.list:
        list_files()
        return

    if args.sample:
        download_sample(args.output)
        return

    if args.file:
        os.makedirs(args.output, exist_ok=True)
        check_gdown()
        file_info = HOW2SIGN_FILES[args.file]
        download_file(file_info["id"], args.output, file_info["name"])
        return

    # Default: show help
    parser.print_help()
    print("\n")
    list_files()


if __name__ == "__main__":
    main()
