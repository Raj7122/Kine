#!/bin/bash
# =============================================================================
# ASL Dynamic Sign Model Training - All in One
# =============================================================================
# This script downloads the WLASL dataset, extracts landmarks, trains the
# LSTM model, and exports it for use in the browser.
#
# Requirements:
#   - Python 3.8+
#   - ffmpeg (brew install ffmpeg)
#   - yt-dlp (brew install yt-dlp)
#
# Usage:
#   chmod +x train_asl_model.sh
#   ./train_asl_model.sh
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

# Check dependencies
echo -e "${YELLOW}Checking dependencies...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is required${NC}"
    exit 1
fi

if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is required. Install with: brew install ffmpeg${NC}"
    exit 1
fi

if ! command -v yt-dlp &> /dev/null; then
    echo -e "${YELLOW}Warning: yt-dlp not found. Installing...${NC}"
    pip install yt-dlp
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
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed with requirements.txt. Installing individually...${NC}"
    pip install tensorflow mediapipe opencv-python numpy pandas scikit-learn tqdm requests yt-dlp matplotlib
fi

# Install tensorflowjs separately (has dependency conflicts)
echo -e "${YELLOW}Installing tensorflowjs...${NC}"
pip install tensorflowjs --no-deps 2>/dev/null || echo "tensorflowjs skipped (will use alternative export)"

echo -e "${GREEN}Dependencies installed${NC}"
echo ""

# Step 3: Download WLASL dataset
echo -e "${YELLOW}Step 2: Downloading WLASL dataset (25 signs, ~20 videos each)...${NC}"
echo "This may take 15-30 minutes depending on your internet connection."
echo ""

python3 download_wlasl.py \
    --output ./data/wlasl \
    --vocab-size 25 \
    --max-videos 20 \
    --cache-dir ./cache

echo -e "${GREEN}Dataset downloaded${NC}"
echo ""

# Step 4: Extract hand landmarks
echo -e "${YELLOW}Step 3: Extracting hand landmarks from videos...${NC}"
echo "This may take 20-40 minutes depending on your CPU."
echo ""

python3 extract_landmarks.py \
    --input ./data/wlasl \
    --output ./data/landmarks

echo -e "${GREEN}Landmarks extracted${NC}"
echo ""

# Step 5: Preprocess data
echo -e "${YELLOW}Step 4: Preprocessing training data...${NC}"

python3 preprocess.py \
    --input ./data/landmarks \
    --output ./data/processed

echo -e "${GREEN}Data preprocessed${NC}"
echo ""

# Step 6: Train the model
echo -e "${YELLOW}Step 5: Training LSTM model...${NC}"
echo "This may take 1-2 hours on CPU, 15-30 minutes on GPU."
echo ""

python3 train.py \
    --data ./data/processed \
    --output ./models \
    --epochs 50 \
    --batch-size 32

echo -e "${GREEN}Model trained${NC}"
echo ""

# Step 7: Export for TensorFlow.js
echo -e "${YELLOW}Step 6: Exporting model for browser...${NC}"

# Create output directory
mkdir -p ../../public/models

python3 export_tfjs.py \
    --model ./models/best_model.h5 \
    --output ../../public/models

echo -e "${GREEN}Model exported to public/models/${NC}"
echo ""

# Done!
echo "=============================================="
echo -e "${GREEN}  Training Complete!${NC}"
echo "=============================================="
echo ""
echo "Model saved to: public/models/asl_cnn_lstm_25.json"
echo ""
echo "The model can now recognize these 25 dynamic signs:"
echo "  HELLO, GOODBYE, PLEASE, THANK_YOU, SORRY,"
echo "  WANT, NEED, HELP, LIKE, UNDERSTAND,"
echo "  WHAT, WHERE, WHO, WHEN, WHY, HOW,"
echo "  YES, NO, MAYBE, GOOD, BAD,"
echo "  I, YOU, NAME, FINISH"
echo ""
echo "Restart your dev server to use the new model!"
echo ""
