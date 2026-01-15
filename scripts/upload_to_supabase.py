#!/usr/bin/env python3
"""
Upload extracted frames to Supabase Storage and update database.

Usage:
    python upload_to_supabase.py --frames ./frames --bucket avatars
    python upload_to_supabase.py --frames ./frames/HELLO --gloss HELLO

Environment variables required:
    SUPABASE_URL - Your Supabase project URL
    SUPABASE_SERVICE_KEY - Service role key (not anon key) for admin access

Requirements:
    pip install -r requirements.txt
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from supabase import create_client, Client
    from dotenv import load_dotenv
    from tqdm import tqdm
except ImportError:
    print("Missing dependencies. Run: pip install -r requirements.txt")
    sys.exit(1)


# Load environment variables from .env.local
load_dotenv(".env.local")
load_dotenv(".env")

# Configuration
DEFAULT_BUCKET = "avatars"
DEFAULT_FPS = 24
CONTENT_TYPE = "image/webp"
MAX_CONCURRENT_UPLOADS = 10


def get_supabase_client() -> Client:
    """
    Create Supabase client with service role key.
    """
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url:
        print("Error: SUPABASE_URL not set")
        print("Set NEXT_PUBLIC_SUPABASE_URL in .env.local or environment")
        sys.exit(1)

    if not key:
        print("Error: SUPABASE_SERVICE_KEY not set")
        print("Get your service role key from Supabase Dashboard -> Settings -> API")
        print("Set SUPABASE_SERVICE_KEY in .env.local or environment")
        sys.exit(1)

    return create_client(url, key)


def ensure_bucket_exists(supabase: Client, bucket_name: str) -> bool:
    """
    Create storage bucket if it doesn't exist.
    """
    try:
        # Check if bucket exists
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]

        if bucket_name not in bucket_names:
            print(f"Creating bucket: {bucket_name}")
            supabase.storage.create_bucket(
                bucket_name,
                options={
                    "public": True,
                    "file_size_limit": 5242880,  # 5MB max per file
                    "allowed_mime_types": ["image/webp", "image/jpeg", "image/png"]
                }
            )
            print(f"Bucket '{bucket_name}' created successfully")
        else:
            print(f"Bucket '{bucket_name}' already exists")

        return True

    except Exception as e:
        print(f"Error with bucket: {e}")
        return False


def upload_file(
    supabase: Client,
    bucket: str,
    local_path: str,
    remote_path: str
) -> bool:
    """
    Upload a single file to Supabase Storage.
    """
    try:
        with open(local_path, "rb") as f:
            data = f.read()

        # Upload with upsert to overwrite existing
        supabase.storage.from_(bucket).upload(
            remote_path,
            data,
            file_options={
                "content-type": CONTENT_TYPE,
                "upsert": "true"
            }
        )
        return True

    except Exception as e:
        # Check if it's a "already exists" error (which is fine with upsert)
        if "already exists" in str(e).lower():
            return True
        print(f"Upload error for {remote_path}: {e}")
        return False


def upload_gloss_frames(
    supabase: Client,
    bucket: str,
    frames_dir: str,
    gloss: str,
    max_workers: int = MAX_CONCURRENT_UPLOADS
) -> int:
    """
    Upload all frames for a single gloss.
    Returns the number of successfully uploaded frames.
    """
    frames_path = Path(frames_dir)
    frames = sorted(frames_path.glob("*.webp"))

    if not frames:
        print(f"No WebP frames found in {frames_dir}")
        return 0

    success_count = 0
    storage_prefix = f"{gloss}/"

    # Upload frames with progress bar
    with tqdm(total=len(frames), desc=f"Uploading {gloss}", leave=False) as pbar:
        for frame in frames:
            remote_path = f"{storage_prefix}{frame.name}"
            if upload_file(supabase, bucket, str(frame), remote_path):
                success_count += 1
            pbar.update(1)

    return success_count


def update_database(
    supabase: Client,
    gloss: str,
    frame_count: int,
    fps: int = DEFAULT_FPS,
    bucket: str = DEFAULT_BUCKET
) -> bool:
    """
    Update avatar_library table with flipbook metadata.
    """
    try:
        storage_path = f"{bucket}/{gloss}"
        duration_ms = int(frame_count / fps * 1000)

        # Update existing entry or insert new one
        result = supabase.table("avatar_library").upsert({
            "gloss_label": gloss,
            "frame_count": frame_count,
            "fps": fps,
            "storage_path": storage_path,
            "video_url": f"flipbook://{storage_path}",  # Marker for flipbook mode
            "category": "asl",  # Default category
            "metadata": {
                "duration_ms": duration_ms,
                "signer_id": "how2sign",
                "dialect": "ASL",
                "source": "How2Sign Dataset"
            }
        }, on_conflict="gloss_label").execute()

        return True

    except Exception as e:
        print(f"Database error for {gloss}: {e}")
        return False


def process_manifest(
    supabase: Client,
    manifest_path: str,
    frames_base_dir: str,
    bucket: str
) -> Dict[str, int]:
    """
    Process manifest.json and upload all glosses.
    """
    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    results: Dict[str, int] = {}
    glosses = manifest.get("glosses", {})

    print(f"Found {len(glosses)} glosses in manifest")

    for gloss, info in glosses.items():
        gloss_frames_dir = os.path.join(frames_base_dir, gloss)

        if not os.path.isdir(gloss_frames_dir):
            print(f"Warning: Frames directory not found for {gloss}")
            continue

        # Upload frames
        uploaded = upload_gloss_frames(supabase, bucket, gloss_frames_dir, gloss)

        if uploaded > 0:
            # Update database
            update_database(supabase, gloss, uploaded, manifest.get("fps", DEFAULT_FPS), bucket)
            results[gloss] = uploaded
            print(f"  {gloss}: {uploaded} frames uploaded")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Upload extracted frames to Supabase Storage"
    )
    parser.add_argument(
        "--frames", "-f",
        required=True,
        help="Directory containing extracted frames (or single gloss directory)"
    )
    parser.add_argument(
        "--bucket", "-b",
        default=DEFAULT_BUCKET,
        help=f"Supabase Storage bucket name (default: {DEFAULT_BUCKET})"
    )
    parser.add_argument(
        "--gloss", "-g",
        help="Gloss label (required if uploading single gloss directory)"
    )
    parser.add_argument(
        "--manifest", "-m",
        help="Path to manifest.json (auto-detected if not specified)"
    )
    parser.add_argument(
        "--workers", "-w",
        type=int,
        default=MAX_CONCURRENT_UPLOADS,
        help=f"Number of concurrent uploads (default: {MAX_CONCURRENT_UPLOADS})"
    )

    args = parser.parse_args()

    frames_path = Path(args.frames)

    if not frames_path.exists():
        print(f"Error: Frames path does not exist: {args.frames}")
        sys.exit(1)

    # Initialize Supabase client
    print("Connecting to Supabase...")
    supabase = get_supabase_client()

    # Ensure bucket exists
    if not ensure_bucket_exists(supabase, args.bucket):
        sys.exit(1)

    # Check if this is a single gloss or manifest-based upload
    manifest_path = args.manifest or os.path.join(args.frames, "manifest.json")

    if args.gloss:
        # Single gloss upload
        print(f"\nUploading single gloss: {args.gloss}")

        uploaded = upload_gloss_frames(
            supabase,
            args.bucket,
            args.frames,
            args.gloss,
            args.workers
        )

        if uploaded > 0:
            update_database(supabase, args.gloss, uploaded, DEFAULT_FPS, args.bucket)
            print(f"\nSuccess! Uploaded {uploaded} frames for {args.gloss}")
        else:
            print("Error: No frames uploaded")
            sys.exit(1)

    elif os.path.isfile(manifest_path):
        # Manifest-based upload
        print(f"\nProcessing manifest: {manifest_path}")

        results = process_manifest(
            supabase,
            manifest_path,
            args.frames,
            args.bucket
        )

        if results:
            total_frames = sum(results.values())
            print(f"\nComplete!")
            print(f"Uploaded {len(results)} glosses")
            print(f"Total frames: {total_frames}")
        else:
            print("Error: No frames uploaded")
            sys.exit(1)

    else:
        # Try to find gloss directories
        print(f"\nScanning for gloss directories in: {args.frames}")

        gloss_dirs = [
            d for d in frames_path.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        ]

        if not gloss_dirs:
            print("No gloss directories found. Use --gloss to specify a gloss label.")
            sys.exit(1)

        results: Dict[str, int] = {}

        for gloss_dir in tqdm(gloss_dirs, desc="Uploading glosses"):
            gloss = gloss_dir.name.upper()
            uploaded = upload_gloss_frames(
                supabase,
                args.bucket,
                str(gloss_dir),
                gloss,
                args.workers
            )

            if uploaded > 0:
                update_database(supabase, gloss, uploaded, DEFAULT_FPS, args.bucket)
                results[gloss] = uploaded

        if results:
            total_frames = sum(results.values())
            print(f"\nComplete!")
            print(f"Uploaded {len(results)} glosses")
            print(f"Total frames: {total_frames}")
        else:
            print("Error: No frames uploaded")
            sys.exit(1)


if __name__ == "__main__":
    main()
