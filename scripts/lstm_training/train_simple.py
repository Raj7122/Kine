#!/usr/bin/env python3
"""
Simple Training Script for CNN-LSTM Model
Works around TensorFlow threading issues on macOS
"""
import os
# Set environment variables BEFORE importing TensorFlow
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
os.environ['TF_NUM_INTEROP_THREADS'] = '1'
os.environ['TF_NUM_INTRAOP_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

import json
from pathlib import Path
import numpy as np

# Now import TensorFlow
import tensorflow as tf
tf.config.threading.set_inter_op_parallelism_threads(1)
tf.config.threading.set_intra_op_parallelism_threads(1)

from tensorflow import keras
from keras import layers, Model


# Configuration
WINDOW_SIZE = 16
FEATURE_COUNT = 63
EPOCHS = 100
BATCH_SIZE = 32
LEARNING_RATE = 0.001


class AttentionLayer(layers.Layer):
    """Simple attention mechanism."""

    def __init__(self, units=64, **kwargs):
        super().__init__(**kwargs)
        self.units = units

    def build(self, input_shape):
        feature_dim = input_shape[-1]
        self.W = self.add_weight(
            shape=(feature_dim, self.units),
            initializer='glorot_uniform',
            trainable=True,
        )
        self.b = self.add_weight(
            shape=(self.units,),
            initializer='zeros',
            trainable=True,
        )
        self.u = self.add_weight(
            shape=(self.units,),
            initializer='glorot_uniform',
            trainable=True,
        )

    def call(self, inputs, mask=None):
        u_it = tf.tanh(tf.tensordot(inputs, self.W, axes=1) + self.b)
        a_it = tf.tensordot(u_it, self.u, axes=1)
        if mask is not None:
            mask = tf.cast(mask, dtype=a_it.dtype)
            a_it = a_it + (1 - mask) * (-1e9)
        alpha = tf.nn.softmax(a_it, axis=1)
        output = tf.reduce_sum(inputs * tf.expand_dims(alpha, -1), axis=1)
        return output

    def get_config(self):
        config = super().get_config()
        config.update({'units': self.units})
        return config


def create_cnn_lstm_model(num_classes, window_size=WINDOW_SIZE, feature_count=FEATURE_COUNT):
    """Create CNN-LSTM model."""
    inputs = layers.Input(shape=(window_size, feature_count), name='input')

    # Masking
    x = layers.Masking(mask_value=0.0)(inputs)

    # Reshape for Conv1D
    x = layers.Reshape((window_size, feature_count, 1))(x)

    # TimeDistributed Conv1D
    x = layers.TimeDistributed(
        layers.Conv1D(128, 3, activation='relu', padding='same')
    )(x)
    x = layers.TimeDistributed(layers.BatchNormalization())(x)
    x = layers.Dropout(0.3)(x)
    x = layers.TimeDistributed(layers.Flatten())(x)

    # Bidirectional LSTM
    x = layers.Bidirectional(layers.LSTM(128, return_sequences=True))(x)

    # Attention
    x = AttentionLayer(units=128)(x)

    # Dense layers
    x = layers.Dense(128, activation='relu')(x)
    x = layers.Dropout(0.5)(x)
    x = layers.Dense(64, activation='relu')(x)
    x = layers.Dropout(0.3)(x)

    # Output
    outputs = layers.Dense(num_classes, activation='softmax')(x)

    return Model(inputs=inputs, outputs=outputs, name='cnn_lstm')


def main():
    print("=" * 60)
    print("CNN-LSTM Training (macOS Compatible)")
    print("=" * 60)

    data_dir = Path('./data/processed')

    # Load data
    print("\nLoading data...")
    X_train = np.load(data_dir / 'X_train.npy')
    y_train = np.load(data_dir / 'y_train.npy')
    X_val = np.load(data_dir / 'X_val.npy')
    y_val = np.load(data_dir / 'y_val.npy')
    X_test = np.load(data_dir / 'X_test.npy')
    y_test = np.load(data_dir / 'y_test.npy')

    with open(data_dir / 'metadata.json', 'r') as f:
        metadata = json.load(f)

    print(f"  Train: {X_train.shape}")
    print(f"  Val: {X_val.shape}")
    print(f"  Test: {X_test.shape}")
    print(f"  Classes: {len(metadata['vocabulary'])}")

    # Create model
    print("\nCreating model...")
    num_classes = len(metadata['vocabulary'])
    model = create_cnn_lstm_model(num_classes)
    model.summary()

    # Compile
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )

    # Callbacks
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor='val_accuracy',
            patience=15,
            restore_best_weights=True,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            min_lr=1e-6,
        ),
    ]

    # Train
    print("\nTraining...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )

    # Evaluate
    print("\nEvaluating...")
    test_loss, test_acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"Test accuracy: {test_acc:.4f}")

    # Save model
    output_dir = Path('./models/cnn_lstm_wlasl25')
    output_dir.mkdir(parents=True, exist_ok=True)

    model.save(output_dir / 'model.keras')
    model.save(output_dir / 'saved_model', save_format='tf')

    # Save training results
    results = {
        'test_accuracy': float(test_acc),
        'test_loss': float(test_loss),
        'best_val_accuracy': float(max(history.history['val_accuracy'])),
        'epochs_trained': len(history.history['loss']),
        'vocabulary': metadata['vocabulary'],
    }

    with open(output_dir / 'training_results.json', 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✓ Model saved to {output_dir}")
    print(f"\nNext: python export_tfjs.py --model {output_dir}/saved_model")


if __name__ == '__main__':
    main()
