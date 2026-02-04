# ASL CNN-LSTM Training Guide

Train a research-grade ASL recognition model using pre-processed Kaggle datasets.

## Quick Start (5 commands)

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set up Kaggle credentials
# Go to https://www.kaggle.com/settings → API → Create New Token
# Save kaggle.json to ~/.kaggle/kaggle.json

# 3. Download dataset
python download_kaggle_datasets.py --dataset lstm-ready

# 4. Prepare data for training
python prepare_kaggle_data.py --dataset lstm-ready

# 5. Train the model
python train.py --data ./data/processed --epochs 150 --optimizer adamw

# 6. Export to TensorFlow.js
python export_tfjs.py --model ./models/run_cnn_lstm_*/final_model --output ../../public/models
```

## Dataset Options

### Option A: Sign Language for LSTM (Recommended for quick start)
- **Size**: Smaller, faster to train
- **Content**: Pre-formatted sequences for temporal modeling
- **Signs**: Simple sentences like "I love you", "Thank you"

```bash
python download_kaggle_datasets.py --dataset lstm-ready
python prepare_kaggle_data.py --dataset lstm-ready
```

### Option B: WLASL Processed (More comprehensive)
- **Size**: 21,083 video clips
- **Content**: Full WLASL dataset with video clips
- **Signs**: 2,000+ ASL signs (we use top 25)

```bash
python download_kaggle_datasets.py --dataset wlasl
python prepare_kaggle_data.py --dataset wlasl --signs 25
```

## Training Configuration

The CNN-LSTM model uses research-validated parameters:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Window Size | 16 frames | ~530ms at 30fps |
| Stride | 8 frames | 50% overlap |
| Features | 63 | Single dominant hand |
| Epochs | 150 | With early stopping |
| Optimizer | AdamW | Better generalization |
| Patience | 15 | Early stopping patience |

### Training Commands

```bash
# Default (recommended)
python train.py --data ./data/processed

# With custom settings
python train.py --data ./data/processed \
    --epochs 200 \
    --batch-size 64 \
    --lr 0.0005 \
    --optimizer adamw

# Legacy Bi-LSTM model (if needed)
python train.py --data ./data/processed --legacy-model
```

## Model Export

After training, export to TensorFlow.js:

```bash
# Find your trained model
ls -la ./models/run_cnn_lstm_*/

# Export (uses latest run by default)
python export_tfjs.py \
    --model ./models/run_cnn_lstm_YYYYMMDD_HHMMSS/final_model \
    --output ../../public/models \
    --name asl_cnn_lstm_25
```

This creates:
- `public/models/asl_cnn_lstm_25.json` - Model entry point
- `public/models/asl_cnn_lstm_25/` - Weight files

## Verify in Browser

1. Start the dev server: `npm run dev`
2. Open browser console and run:

```javascript
// Check model loaded
getLSTMState()

// Test inference
testLSTMInference()

// Check detection state
getHybridDetectionState()
```

## Target Accuracy

Based on validated research:
- **Static alphabet (A-Z)**: 95%+ accuracy
- **Dynamic gestures**: 90%+ accuracy
- **Real-time**: 30+ FPS

## Troubleshooting

### Kaggle Download Fails
```bash
# Check credentials
cat ~/.kaggle/kaggle.json

# Or use environment variables
export KAGGLE_USERNAME=your_username
export KAGGLE_KEY=your_api_key
```

### Out of Memory During Training
```bash
# Reduce batch size
python train.py --batch-size 16
```

### Model Not Loading in Browser
1. Check file path in `constants.ts`: `LSTM_MODEL_PATH = '/models/asl_cnn_lstm_25.json'`
2. Verify files exist in `public/models/`
3. Check browser console for errors

## File Structure After Training

```
scripts/lstm_training/
├── data/
│   ├── lstm_ready/          # Raw Kaggle download
│   └── processed/           # Prepared for training
│       ├── X_train.npy
│       ├── y_train.npy
│       ├── X_val.npy
│       ├── y_val.npy
│       ├── X_test.npy
│       ├── y_test.npy
│       └── metadata.json
├── models/
│   └── run_cnn_lstm_YYYYMMDD_HHMMSS/
│       ├── best_model.keras
│       ├── final_model/
│       ├── training_results.json
│       └── training_log.csv
└── ...

public/models/
├── asl_cnn_lstm_25.json     # TF.js model entry
├── asl_cnn_lstm_25/         # Weight files
│   └── group1-shard1of1.bin
└── metadata.json
```
