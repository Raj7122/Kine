#!/usr/bin/env python3
"""
Training Script for ASL LSTM Model

Usage:
    python train.py --data ./data/processed --output ./models
    python train.py --data ./data/processed --output ./models --epochs 100 --batch-size 32
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Tuple, Optional
import numpy as np
import tensorflow as tf
from tensorflow import keras

from model import create_model, compile_model, create_learning_rate_schedule, count_parameters


def load_data(data_dir: Path) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    """
    Load preprocessed data from directory.

    Returns:
        X_train, y_train, X_val, y_val, X_test, y_test, metadata
    """
    X_train = np.load(data_dir / 'X_train.npy')
    y_train = np.load(data_dir / 'y_train.npy')
    X_val = np.load(data_dir / 'X_val.npy')
    y_val = np.load(data_dir / 'y_val.npy')
    X_test = np.load(data_dir / 'X_test.npy')
    y_test = np.load(data_dir / 'y_test.npy')

    with open(data_dir / 'metadata.json', 'r') as f:
        metadata = json.load(f)

    return X_train, y_train, X_val, y_val, X_test, y_test, metadata


def create_callbacks(
    output_dir: Path,
    patience: int = 10,
    min_delta: float = 0.001,
) -> list:
    """Create training callbacks."""

    callbacks = [
        # Early stopping
        keras.callbacks.EarlyStopping(
            monitor='val_accuracy',
            patience=patience,
            min_delta=min_delta,
            restore_best_weights=True,
            verbose=1,
        ),

        # Model checkpoint
        keras.callbacks.ModelCheckpoint(
            filepath=str(output_dir / 'best_model.keras'),
            monitor='val_accuracy',
            save_best_only=True,
            verbose=1,
        ),

        # Learning rate reduction
        keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            min_lr=1e-6,
            verbose=1,
        ),

        # TensorBoard logging
        keras.callbacks.TensorBoard(
            log_dir=str(output_dir / 'logs'),
            histogram_freq=1,
        ),

        # CSV logger
        keras.callbacks.CSVLogger(
            str(output_dir / 'training_log.csv'),
        ),
    ]

    return callbacks


def train_model(
    model: keras.Model,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    output_dir: Path,
    epochs: int = 100,
    batch_size: int = 32,
    patience: int = 10,
) -> keras.callbacks.History:
    """
    Train the model.

    Returns:
        Training history
    """
    callbacks = create_callbacks(output_dir, patience=patience)

    # Calculate class weights for imbalanced data
    unique, counts = np.unique(y_train, return_counts=True)
    total = len(y_train)
    class_weights = {int(cls): total / (len(unique) * count) for cls, count in zip(unique, counts)}

    print(f"\nClass weights: {class_weights}")

    # Train
    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=batch_size,
        callbacks=callbacks,
        class_weight=class_weights,
        verbose=1,
    )

    return history


def evaluate_model(
    model: keras.Model,
    X_test: np.ndarray,
    y_test: np.ndarray,
    vocabulary: list,
) -> dict:
    """
    Evaluate the model on test data.

    Returns:
        Evaluation metrics
    """
    print("\nEvaluating on test set...")

    # Get predictions
    y_pred_probs = model.predict(X_test, verbose=0)
    y_pred = np.argmax(y_pred_probs, axis=1)

    # Calculate metrics
    test_loss, test_acc, test_top3 = model.evaluate(X_test, y_test, verbose=0)

    # Per-class accuracy
    class_correct = {}
    class_total = {}

    for true_label, pred_label in zip(y_test, y_pred):
        true_label = int(true_label)
        if true_label not in class_total:
            class_total[true_label] = 0
            class_correct[true_label] = 0

        class_total[true_label] += 1
        if true_label == pred_label:
            class_correct[true_label] += 1

    per_class_accuracy = {}
    for cls in class_total:
        sign = vocabulary[cls] if cls < len(vocabulary) else f'class_{cls}'
        per_class_accuracy[sign] = class_correct[cls] / class_total[cls]

    results = {
        'test_loss': float(test_loss),
        'test_accuracy': float(test_acc),
        'test_top3_accuracy': float(test_top3),
        'per_class_accuracy': per_class_accuracy,
        'n_test_samples': len(y_test),
    }

    return results


def save_training_results(
    output_dir: Path,
    history: keras.callbacks.History,
    eval_results: dict,
    metadata: dict,
    model: keras.Model,
):
    """Save training results and metadata."""

    # Training history
    history_dict = {
        'loss': [float(x) for x in history.history.get('loss', [])],
        'accuracy': [float(x) for x in history.history.get('accuracy', [])],
        'val_loss': [float(x) for x in history.history.get('val_loss', [])],
        'val_accuracy': [float(x) for x in history.history.get('val_accuracy', [])],
        'top3_accuracy': [float(x) for x in history.history.get('top3_accuracy', [])],
        'val_top3_accuracy': [float(x) for x in history.history.get('val_top3_accuracy', [])],
    }

    # Model info
    params = count_parameters(model)

    results = {
        'timestamp': datetime.now().isoformat(),
        'vocabulary': metadata['vocabulary'],
        'num_classes': len(metadata['vocabulary']),
        'window_size': metadata['window_size'],
        'feature_count': metadata['feature_count'],
        'model_parameters': params,
        'training_history': history_dict,
        'evaluation': eval_results,
        'best_val_accuracy': float(max(history.history.get('val_accuracy', [0]))),
        'epochs_trained': len(history.history.get('loss', [])),
    }

    with open(output_dir / 'training_results.json', 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\nResults saved to: {output_dir / 'training_results.json'}")


def main():
    parser = argparse.ArgumentParser(description='Train ASL LSTM model')
    parser.add_argument('--data', type=str, default='./data/processed',
                        help='Directory with preprocessed data')
    parser.add_argument('--output', type=str, default='./models',
                        help='Output directory for trained model')
    parser.add_argument('--epochs', type=int, default=100,
                        help='Maximum training epochs')
    parser.add_argument('--batch-size', type=int, default=32,
                        help='Training batch size')
    parser.add_argument('--lr', type=float, default=0.001,
                        help='Initial learning rate')
    parser.add_argument('--patience', type=int, default=10,
                        help='Early stopping patience')
    parser.add_argument('--no-attention', action='store_true',
                        help='Disable attention mechanism')
    args = parser.parse_args()

    data_dir = Path(args.data)
    output_dir = Path(args.output)

    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}")
        return

    # Create output directory with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = output_dir / f'run_{timestamp}'
    os.makedirs(output_dir, exist_ok=True)

    print(f"Training run: {output_dir}")

    # Load data
    print("\nLoading data...")
    X_train, y_train, X_val, y_val, X_test, y_test, metadata = load_data(data_dir)

    print(f"  Train: {X_train.shape} samples")
    print(f"  Val: {X_val.shape} samples")
    print(f"  Test: {X_test.shape} samples")
    print(f"  Classes: {len(metadata['vocabulary'])}")

    # Create model
    print("\nCreating model...")
    num_classes = len(metadata['vocabulary'])

    model = create_model(
        num_classes=num_classes,
        window_size=metadata['window_size'],
        feature_count=metadata['feature_count'],
        use_attention=not args.no_attention,
    )

    # Calculate decay steps based on dataset size
    steps_per_epoch = len(X_train) // args.batch_size
    decay_steps = steps_per_epoch * args.epochs

    lr_schedule = create_learning_rate_schedule(
        initial_lr=args.lr,
        decay_steps=decay_steps,
    )

    optimizer = keras.optimizers.Adam(learning_rate=lr_schedule)

    model.compile(
        optimizer=optimizer,
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy', keras.metrics.SparseTopKCategoricalAccuracy(k=3, name='top3_accuracy')],
    )

    model.summary()

    params = count_parameters(model)
    print(f"\nModel parameters: {params['total']:,}")

    # Train
    print("\nStarting training...")
    history = train_model(
        model,
        X_train, y_train,
        X_val, y_val,
        output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        patience=args.patience,
    )

    # Load best model
    best_model_path = output_dir / 'best_model.keras'
    if best_model_path.exists():
        print(f"\nLoading best model from: {best_model_path}")
        model = keras.models.load_model(best_model_path)

    # Evaluate
    eval_results = evaluate_model(model, X_test, y_test, metadata['vocabulary'])

    print(f"\nTest Results:")
    print(f"  Loss: {eval_results['test_loss']:.4f}")
    print(f"  Accuracy: {eval_results['test_accuracy']:.4f}")
    print(f"  Top-3 Accuracy: {eval_results['test_top3_accuracy']:.4f}")

    print(f"\nPer-class accuracy:")
    for sign, acc in sorted(eval_results['per_class_accuracy'].items(), key=lambda x: -x[1]):
        print(f"  {sign}: {acc:.4f}")

    # Save results
    save_training_results(output_dir, history, eval_results, metadata, model)

    # Save final model in multiple formats
    model.save(output_dir / 'final_model.keras')
    model.save(output_dir / 'final_model', save_format='tf')  # SavedModel format for TF.js

    print(f"\nTraining complete!")
    print(f"  Best validation accuracy: {max(history.history['val_accuracy']):.4f}")
    print(f"  Test accuracy: {eval_results['test_accuracy']:.4f}")
    print(f"  Model saved to: {output_dir}")
    print(f"\nNext step: Run export_tfjs.py to convert to TensorFlow.js format")


if __name__ == '__main__':
    main()
