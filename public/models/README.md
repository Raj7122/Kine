# LSTM Model Directory

This directory contains the TensorFlow.js model files for ASL dynamic gesture recognition.

## Expected Files

After training and exporting the model, this directory should contain:

```
models/
├── asl_cnn_lstm_25.json      # Model entry point
├── asl_cnn_lstm_25/          # Model assets directory
│   ├── model.json            # Model topology
│   ├── group1-shard1of1.bin  # Model weights
│   └── metadata.json         # Training metadata
└── README.md                 # This file
```

## Training the Model

To train the LSTM model:

1. **Setup Python environment:**
   ```bash
   cd scripts/lstm_training
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Prepare Kaggle dataset (default):**
   ```bash
   python prepare_kaggle_data.py --download --competition asl-signs --output ./data/landmarks
   ```

   **Or use WLASL fallback:**
   ```bash
   python download_wlasl.py --output ./data/wlasl --vocab-size 25
   python extract_landmarks.py --input ./data/wlasl --output ./data/landmarks --split
   ```

3. **Preprocess data:**
   ```bash
   python preprocess.py --input ./data/landmarks --output ./data/processed
   ```

4. **Train model:**
   ```bash
   python train.py --data ./data/processed --output ./models --epochs 100
   ```

5. **Export to TensorFlow.js:**
   ```bash
   python export_tfjs.py --model ./models/run_xxx/final_model.keras --output ../../public/models --name asl_cnn_lstm_25
   ```

Or run the all-in-one pipeline:

```bash
./train_asl_model.sh                 # Kaggle default
./train_asl_model.sh --source wlasl # WLASL fallback
```

## Model Architecture

- **Input:** (batch, 16, 63) - 16 frames × 63 features (dominant hand)
- **Architecture:** CNN-LSTM with Attention
- **Output:** 25 sign classes (softmax)
- **Target size:** < 2MB (quantized)

## Vocabulary (25 signs)

HELLO, GOODBYE, PLEASE, THANK_YOU, SORRY,
WANT, NEED, HELP, LIKE, UNDERSTAND,
WHAT, WHERE, WHO, WHEN, WHY, HOW,
YES, NO, MAYBE, GOOD, BAD,
I, YOU, NAME, FINISH
