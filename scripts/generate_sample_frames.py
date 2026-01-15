#!/usr/bin/env python3
"""
Generate sample flipbook frames for testing the Kine avatar system.

Since How2Sign dataset has Google Drive rate limits, this creates
placeholder frames for testing the flipbook player immediately.

Usage:
    python generate_sample_frames.py --output ./frames

The frames simulate simple hand position animations for common ASL glosses.
"""

import os
import argparse
import json
from PIL import Image, ImageDraw, ImageFont

# Sample glosses with animation descriptions
SAMPLE_GLOSSES = {
    "HELLO": {
        "frames": 24,  # 1 second at 24fps
        "color_start": (255, 200, 100),  # Yellow-ish
        "color_end": (200, 150, 50),
        "description": "Wave motion"
    },
    "THANK-YOU": {
        "frames": 30,  # 1.25 seconds
        "color_start": (100, 200, 255),  # Blue-ish
        "color_end": (50, 150, 200),
        "description": "Hand from chin outward"
    },
    "PLEASE": {
        "frames": 24,
        "color_start": (200, 255, 150),  # Green-ish
        "color_end": (150, 200, 100),
        "description": "Circular motion on chest"
    },
    "YES": {
        "frames": 18,  # 0.75 seconds
        "color_start": (150, 255, 150),  # Green
        "color_end": (100, 200, 100),
        "description": "Fist nodding"
    },
    "NO": {
        "frames": 18,
        "color_start": (255, 150, 150),  # Red-ish
        "color_end": (200, 100, 100),
        "description": "Finger snap"
    },
    "HELP": {
        "frames": 24,
        "color_start": (255, 200, 200),  # Pink-ish
        "color_end": (200, 150, 150),
        "description": "Thumbs up lifting"
    },
    "SORRY": {
        "frames": 24,
        "color_start": (200, 200, 255),  # Purple-ish
        "color_end": (150, 150, 200),
        "description": "Fist on chest circular"
    },
    "GOOD": {
        "frames": 20,
        "color_start": (255, 255, 150),  # Yellow
        "color_end": (200, 200, 100),
        "description": "Hand from chin down"
    },
    "BAD": {
        "frames": 20,
        "color_start": (150, 150, 150),  # Gray
        "color_end": (100, 100, 100),
        "description": "Hand flip"
    },
    "COFFEE": {
        "frames": 30,
        "color_start": (139, 90, 43),  # Brown
        "color_end": (100, 60, 30),
        "description": "Grinding motion"
    },
    "WATER": {
        "frames": 18,
        "color_start": (100, 150, 255),  # Blue
        "color_end": (70, 120, 200),
        "description": "W on chin"
    },
    "FOOD": {
        "frames": 24,
        "color_start": (255, 180, 100),  # Orange
        "color_end": (200, 140, 70),
        "description": "Bunched fingers to mouth"
    },
    "LOVE": {
        "frames": 24,
        "color_start": (255, 100, 150),  # Pink
        "color_end": (200, 70, 120),
        "description": "Crossed arms on chest"
    },
    "FRIEND": {
        "frames": 24,
        "color_start": (255, 200, 150),  # Peach
        "color_end": (200, 150, 100),
        "description": "Hooked fingers"
    },
    "FAMILY": {
        "frames": 30,
        "color_start": (200, 180, 255),  # Lavender
        "color_end": (150, 130, 200),
        "description": "F hands circle"
    },
    # NYC-related glosses
    "SUBWAY": {
        "frames": 30,
        "color_start": (100, 100, 200),  # Subway blue
        "color_end": (70, 70, 150),
        "description": "Underground motion"
    },
    "CITY": {
        "frames": 24,
        "color_start": (150, 150, 150),  # Gray
        "color_end": (100, 100, 100),
        "description": "Buildings touching"
    },
    "TAXI": {
        "frames": 24,
        "color_start": (255, 200, 0),  # Yellow cab
        "color_end": (200, 150, 0),
        "description": "Roof pat"
    },
    "WORK": {
        "frames": 24,
        "color_start": (100, 150, 200),  # Steel blue
        "color_end": (70, 120, 170),
        "description": "S hands hitting"
    },
    "MONEY": {
        "frames": 24,
        "color_start": (100, 200, 100),  # Money green
        "color_end": (70, 150, 70),
        "description": "Bills in palm"
    },
}


def interpolate_color(start, end, t):
    """Interpolate between two colors."""
    return tuple(int(s + (e - s) * t) for s, e in zip(start, end))


def create_hand_shape(draw, center, size, frame_num, total_frames, gloss):
    """Draw a simple animated hand shape."""
    # Animation progress
    t = frame_num / total_frames
    wave = abs(0.5 - t) * 2  # 0 to 1 to 0

    # Base hand position
    x, y = center
    x_offset = int(20 * (0.5 - t) * 2)
    y_offset = int(10 * wave)

    # Draw palm (oval)
    palm_size = size // 2
    palm_box = [
        x - palm_size + x_offset,
        y - palm_size // 1.5 + y_offset,
        x + palm_size + x_offset,
        y + palm_size // 1.5 + y_offset
    ]
    draw.ellipse(palm_box, fill=(255, 220, 180), outline=(200, 170, 130), width=2)

    # Draw fingers
    finger_length = size // 2
    finger_spread = [
        (-0.4 + wave * 0.1, -0.8),
        (-0.2 + wave * 0.05, -0.9),
        (0, -1),
        (0.2 - wave * 0.05, -0.9),
        (0.4 - wave * 0.1, -0.7),
    ]

    for i, (dx, dy) in enumerate(finger_spread):
        finger_x = x + int(dx * palm_size) + x_offset
        finger_y = y + int(dy * finger_length) + y_offset
        finger_width = 8 if i == 0 else 10  # Thumb is thinner

        # Finger line
        draw.line(
            [(x + x_offset, y - palm_size // 3 + y_offset), (finger_x, finger_y)],
            fill=(255, 220, 180),
            width=finger_width
        )
        # Fingertip
        draw.ellipse(
            [finger_x - 5, finger_y - 5, finger_x + 5, finger_y + 5],
            fill=(255, 210, 170)
        )


def generate_frame(gloss, frame_num, total_frames, output_path, size=256):
    """Generate a single frame for a gloss animation."""
    info = SAMPLE_GLOSSES[gloss]

    # Create image with gradient background
    t = frame_num / total_frames
    bg_color = interpolate_color(info["color_start"], info["color_end"], t)

    img = Image.new("RGB", (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    # Draw circular background
    margin = 20
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(30, 30, 40),
        outline=(60, 60, 80),
        width=3
    )

    # Draw animated hand
    create_hand_shape(
        draw,
        center=(size // 2, size // 2 + 20),
        size=100,
        frame_num=frame_num,
        total_frames=total_frames,
        gloss=gloss
    )

    # Add gloss label
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
    except:
        font = ImageFont.load_default()

    # Draw label background
    label = gloss
    bbox = draw.textbbox((0, 0), label, font=font)
    label_width = bbox[2] - bbox[0]
    label_x = (size - label_width) // 2
    label_y = size - 40

    draw.rectangle(
        [label_x - 10, label_y - 5, label_x + label_width + 10, label_y + 20],
        fill=(0, 0, 0, 180)
    )
    draw.text((label_x, label_y), label, fill=(255, 200, 50), font=font)

    # Add frame counter
    counter_text = f"{frame_num + 1}/{total_frames}"
    draw.text((10, 10), counter_text, fill=(200, 200, 200), font=font)

    # Save as WebP
    frame_name = f"{frame_num + 1:04d}.webp"
    filepath = os.path.join(output_path, frame_name)
    img.save(filepath, "WEBP", quality=85)

    return filepath


def generate_gloss_frames(gloss, output_dir):
    """Generate all frames for a single gloss."""
    info = SAMPLE_GLOSSES[gloss]
    gloss_dir = os.path.join(output_dir, gloss)
    os.makedirs(gloss_dir, exist_ok=True)

    print(f"  Generating {info['frames']} frames for {gloss}...")

    for frame_num in range(info["frames"]):
        generate_frame(gloss, frame_num, info["frames"], gloss_dir)

    return {
        "gloss": gloss,
        "frame_count": info["frames"],
        "fps": 24,
        "path": gloss_dir
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate sample flipbook frames for testing"
    )
    parser.add_argument(
        "--output", "-o",
        default="./frames",
        help="Output directory for frames (default: ./frames)"
    )
    parser.add_argument(
        "--glosses", "-g",
        nargs="*",
        default=None,
        help="Specific glosses to generate (default: all)"
    )

    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    glosses_to_generate = args.glosses if args.glosses else list(SAMPLE_GLOSSES.keys())

    print(f"\n=== Generating Sample Flipbook Frames ===\n")
    print(f"Output directory: {args.output}")
    print(f"Glosses: {len(glosses_to_generate)}\n")

    manifest = {"glosses": {}, "fps": 24, "generated": True}

    for gloss in glosses_to_generate:
        if gloss not in SAMPLE_GLOSSES:
            print(f"  Warning: Unknown gloss '{gloss}', skipping")
            continue

        result = generate_gloss_frames(gloss, args.output)
        manifest["glosses"][gloss] = {
            "frame_count": result["frame_count"],
            "fps": result["fps"],
            "storage_path": f"avatars/{gloss}"
        }

    # Save manifest
    manifest_path = os.path.join(args.output, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n=== Generation Complete ===")
    print(f"Generated frames for {len(manifest['glosses'])} glosses")
    print(f"Manifest saved to: {manifest_path}")
    print(f"\nNext step: python upload_to_supabase.py --frames {args.output}")


if __name__ == "__main__":
    main()
