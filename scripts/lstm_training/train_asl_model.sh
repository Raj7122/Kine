#!/bin/bash
# =============================================================================
# ASL Dynamic Sign Model Training - All in One
# =============================================================================
# This script prepares landmarks from Kaggle, WLASL, or a hybrid of both,
# trains the LSTM model, and exports it for use in the browser.
#
# Requirements:
#   - Python 3.8+
#   - Kaggle CLI credentials for --source kaggle/hybrid
#   - ffmpeg + yt-dlp for --source wlasl/hybrid
#
# Usage:
#   chmod +x train_asl_model.sh
#   ./train_asl_model.sh                  # Hybrid (default)
#   ./train_asl_model.sh --source kaggle  # Kaggle-only
#   ./train_asl_model.sh --source wlasl   # WLASL-only
#   ./train_asl_model.sh --source hybrid  # Explicit hybrid
# =============================================================================

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=============================================="
echo "  ASL Dynamic Sign Model Training Pipeline"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse arguments
DATASET_SOURCE="hybrid"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --source)
            DATASET_SOURCE="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Usage: ./train_asl_model.sh [--source kaggle|wlasl|hybrid]"
            exit 1
            ;;
    esac
done

if [[ "$DATASET_SOURCE" != "kaggle" && "$DATASET_SOURCE" != "wlasl" && "$DATASET_SOURCE" != "hybrid" ]]; then
    echo -e "${RED}Invalid --source value: $DATASET_SOURCE${NC}"
    echo "Expected: kaggle, wlasl, or hybrid"
    exit 1
fi

# Check dependencies
echo -e "${YELLOW}Checking dependencies...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is required${NC}"
    exit 1
fi

if [ "$DATASET_SOURCE" = "wlasl" ] || [ "$DATASET_SOURCE" = "hybrid" ]; then
    if ! command -v ffmpeg &> /dev/null; then
        echo -e "${RED}Error: ffmpeg is required for --source wlasl/hybrid. Install with: brew install ffmpeg${NC}"
        exit 1
    fi

    if ! command -v yt-dlp &> /dev/null; then
        echo -e "${YELLOW}Warning: yt-dlp not found. Installing...${NC}"
        pip install yt-dlp
    fi
fi

echo -e "${GREEN}Dependencies OK${NC}"
echo ""

# Step 1: Create virtual environment (optional but recommended)
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Step 0: Creating virtual environment...${NC}"
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip first
echo -e "${YELLOW}Upgrading pip...${NC}"
pip install --upgrade pip -q

# Step 2: Install Python dependencies
echo -e "${YELLOW}Step 1: Installing Python dependencies...${NC}"
pip install --no-compile -r requirements.txt
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed with requirements.txt. Installing individually...${NC}"
    pip install --no-compile tensorflow==2.19.0 tf-keras==2.19.0 tensorflow-decision-forests==1.12.0 tensorflow-hub==0.16.1 tensorflowjs==4.22.0 mediapipe opencv-python numpy pandas scikit-learn tqdm requests yt-dlp matplotlib kaggle pyarrow fastparquet
fi

# Ensure tensorflowjs converter is available
echo -e "${YELLOW}Checking tensorflowjs converter...${NC}"
if ! command -v tensorflowjs_converter >/dev/null 2>&1; then
    pip install --no-compile tensorflowjs
fi

echo -e "${GREEN}Dependencies installed${NC}"
echo ""

# Step 3: Prepare dataset landmarks
if [ "$DATASET_SOURCE" = "kaggle" ]; then
    KAGGLE_MAX_PER_SIGN="${KAGGLE_MAX_PER_SIGN:-0}"

    if ! command -v kaggle &> /dev/null; then
        echo -e "${RED}Error: kaggle CLI is required for --source kaggle${NC}"
        echo "Install with: pip install kaggle"
        echo "Then configure ~/.kaggle/kaggle.json"
        exit 1
    fi

    echo -e "${YELLOW}Step 2: Preparing Kaggle ASL dataset (19 signs)...${NC}"
    echo "This downloads/parses the Google Isolated ASL landmark parquet files."
    echo "Max samples per sign: ${KAGGLE_MAX_PER_SIGN} (0 means all)"
    echo ""

    python3 prepare_kaggle_data.py \
        --download \
        --competition asl-signs \
        --dataset-dir ./data/kaggle_raw \
        --cache-dir ./cache/kaggle \
        --output ./data/landmarks \
        --max-per-sign "$KAGGLE_MAX_PER_SIGN"

    echo -e "${GREEN}Kaggle dataset prepared${NC}"
    echo ""
elif [ "$DATASET_SOURCE" = "wlasl" ]; then
    # WLASL-only flow
    echo -e "${YELLOW}Step 2: Downloading WLASL dataset (10 targeted signs, up to 20 videos each)...${NC}"
    echo "This may take 15-30 minutes depending on your internet connection."
    echo ""

    python3 download_wlasl.py \
        --output ./data/wlasl \
        --vocab-size 10 \
        --max-videos 20 \
        --cache-dir ./cache

    echo -e "${GREEN}Dataset downloaded${NC}"
    echo ""

    echo -e "${YELLOW}Step 3: Extracting hand landmarks from videos...${NC}"
    echo "This may take 20-40 minutes depending on your CPU."
    echo ""

    python3 extract_landmarks.py \
        --input ./data/wlasl \
        --output ./data/landmarks \
        --split

    echo -e "${GREEN}Landmarks extracted${NC}"
    echo ""
else
    # Hybrid flow: Kaggle + WLASL
    KAGGLE_MAX_PER_SIGN="${KAGGLE_MAX_PER_SIGN:-50}"
    WLASL_MAX_VIDEOS="${WLASL_MAX_VIDEOS:-20}"

    if ! command -v kaggle &> /dev/null; then
        echo -e "${RED}Error: kaggle CLI is required for --source hybrid${NC}"
        echo "Install with: pip install kaggle"
        echo "Then configure ~/.kaggle/kaggle.json"
        exit 1
    fi

    echo -e "${YELLOW}Step 2: Preparing Kaggle ASL dataset (19 signs)...${NC}"
    echo "Max samples per sign: ${KAGGLE_MAX_PER_SIGN}"
    python3 prepare_kaggle_data.py \
        --download \
        --competition asl-signs \
        --dataset-dir ./data/kaggle_raw \
        --cache-dir ./cache/kaggle \
        --output ./data/landmarks \
        --max-per-sign "$KAGGLE_MAX_PER_SIGN"

    echo -e "${YELLOW}Step 2b: Downloading WLASL gap signs (10 signs)...${NC}"
    python3 download_wlasl.py \
        --output ./data/wlasl \
        --vocab-size 10 \
        --max-videos "$WLASL_MAX_VIDEOS" \
        --cache-dir ./cache

    echo -e "${YELLOW}Step 2c: Extracting WLASL landmarks into shared landmark directory...${NC}"
    python3 extract_landmarks.py \
        --input ./data/wlasl \
        --output ./data/landmarks

    echo -e "${GREEN}Hybrid landmark data prepared${NC}"
    echo ""
fi

echo -e "${YELLOW}Step 2.5: Building unified splits + vocabulary...${NC}"
python3 merge_data_sources.py --landmarks-dir ./data/landmarks
echo -e "${GREEN}Unified splits ready${NC}"
echo ""

# Step 4: Preprocess data
echo -e "${YELLOW}Step 3: Preprocessing training data...${NC}"

python3 preprocess.py \
    --input ./data/landmarks \
    --output ./data/processed

echo -e "${GREEN}Data preprocessed${NC}"
echo ""

# Step 5: Train the model
echo -e "${YELLOW}Step 4: Training LSTM model...${NC}"
echo "This may take 1-2 hours on CPU, 15-30 minutes on GPU."
echo ""

python3 train.py \
    --data ./data/processed \
    --output ./models \
    --batch-size 32

echo -e "${GREEN}Model trained${NC}"
echo ""

# Locate latest training run
LATEST_RUN=$(ls -dt ./models/run_* 2>/dev/null | head -1)
if [ -z "$LATEST_RUN" ]; then
    echo -e "${RED}Error: No training run found in ./models${NC}"
    exit 1
fi

# Step 6: Export for TensorFlow.js
echo -e "${YELLOW}Step 5: Exporting model for browser...${NC}"

# Create output directory
mkdir -p ../../public/models

python3 export_tfjs.py \
    --model "$LATEST_RUN/final_model" \
    --training-results "$LATEST_RUN/training_results.json" \
    --output ../../public/models \
    --name asl_cnn_lstm_25

echo -e "${GREEN}Model exported to public/models/${NC}"
echo ""

# Done!
echo "=============================================="
echo -e "${GREEN}  Training Complete!${NC}"
echo "=============================================="
echo ""
echo "Dataset source: $DATASET_SOURCE"
echo "Training run: $LATEST_RUN"
echo "Model saved to: public/models/asl_cnn_lstm_25.json"
echo ""
echo "The model can now recognize the signs listed in ./data/landmarks/vocabulary.json"
python3 - <<'PY'
import json
from pathlib import Path

vocab_path = Path('./data/landmarks/vocabulary.json')
if not vocab_path.exists():
    print('  (vocabulary.json not found)')
else:
    payload = json.loads(vocab_path.read_text(encoding='utf-8'))
    vocab = payload.get('vocabulary', []) if isinstance(payload, dict) else payload
    print(f'  Total signs: {len(vocab)}')
    if vocab:
        print('  ' + ', '.join(vocab))
PY
echo ""
echo "Restart your dev server to use the new model!"
echo ""
