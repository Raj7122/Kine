# LSTM Model Directory

This directory contains the TensorFlow.js model files for ASL dynamic gesture recognition.

## Expected Files

After training and exporting the model, this directory should contain:

```
models/
├── asl_lstm_25.json          # Model entry point
├── asl_lstm_25/              # Model assets directory
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

2. **Download WLASL dataset:**
   ```bash
   python download_wlasl.py --output ./data/wlasl --vocab-size 25
   ```

3. **Extract landmarks:**
   ```bash
   python extract_landmarks.py --input ./data/wlasl --output ./data/landmarks --split
   ```

4. **Preprocess data:**
   ```bash
   python preprocess.py --input ./data/landmarks --output ./data/processed
   ```

5. **Train model:**
   ```bash
   python train.py --data ./data/processed --output ./models --epochs 100
   ```

6. **Export to TensorFlow.js:**
   ```bash
   python export_tfjs.py --model ./models/run_xxx/final_model --output ../../public/models
   ```

## Model Architecture

- **Input:** (batch, 32, 126) - 32 frames × 126 features
- **Architecture:** Bi-LSTM with Attention
- **Output:** 25 sign classes (softmax)
- **Target size:** < 2MB (quantized)

## Vocabulary (25 signs)

HELLO, GOODBYE, PLEASE, THANK_YOU, SORRY,
WANT, NEED, HELP, LIKE, UNDERSTAND,
WHAT, WHERE, WHO, WHEN, WHY, HOW,
YES, NO, MAYBE, GOOD, BAD,
I, YOU, NAME, FINISH
