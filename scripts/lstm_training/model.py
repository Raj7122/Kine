#!/usr/bin/env python3
"""
LSTM Model Architecture for ASL Dynamic Gesture Recognition

Research-Grade CNN-LSTM Architecture:
    Input: (batch, 16, 63) - 16 frames, 63 features per frame (single dominant hand)
    Masking -> Reshape -> TimeDistributed(Conv1D) -> BatchNorm -> Dropout
    -> Flatten -> Bi-LSTM(128) -> Attention -> Dense(128) -> Dense(64) -> Softmax

Based on validated research:
- Indian ISL: 97.75% precision
- FAU: 98% accuracy

Usage:
    from model import create_model, create_cnn_lstm_model
    model = create_cnn_lstm_model(num_classes=25)  # Research-grade
    model = create_model(num_classes=25)  # Legacy Bi-LSTM only
"""

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model
from typing import Tuple, Optional


# Constants (must match TypeScript config - research-grade values)
WINDOW_SIZE = 16
FEATURE_COUNT = 63  # Single dominant hand: 21 landmarks × 3 coords

# CNN-LSTM architecture constants
CNN_FILTERS = 128
CNN_KERNEL_SIZE = 3
LSTM_UNITS = 128  # Units for bidirectional (256 total)
DENSE_UNITS = [128, 64]
DROPOUT_CNN = 0.3
DROPOUT_DENSE_1 = 0.5
DROPOUT_DENSE_2 = 0.3


class AttentionLayer(layers.Layer):
    """
    Attention mechanism for sequence data.
    Learns to weight different time steps based on relevance.
    """

    def __init__(self, units: int = 64, **kwargs):
        super().__init__(**kwargs)
        self.units = units

    def build(self, input_shape):
        # Input shape: (batch, time_steps, features)
        feature_dim = input_shape[-1]

        self.W = self.add_weight(
            name='attention_weight',
            shape=(feature_dim, self.units),
            initializer='glorot_uniform',
            trainable=True,
        )
        self.b = self.add_weight(
            name='attention_bias',
            shape=(self.units,),
            initializer='zeros',
            trainable=True,
        )
        self.u = self.add_weight(
            name='attention_context',
            shape=(self.units,),
            initializer='glorot_uniform',
            trainable=True,
        )

        super().build(input_shape)

    def call(self, inputs, mask=None):
        # inputs shape: (batch, time_steps, features)

        # Compute attention scores
        # (batch, time_steps, units)
        u_it = tf.tanh(tf.tensordot(inputs, self.W, axes=1) + self.b)

        # (batch, time_steps)
        a_it = tf.tensordot(u_it, self.u, axes=1)

        # Apply mask if provided
        if mask is not None:
            # Convert mask to float and expand dims
            mask = tf.cast(mask, dtype=a_it.dtype)
            # Set masked positions to very negative value
            a_it = a_it + (1 - mask) * (-1e9)

        # Softmax over time dimension
        alpha = tf.nn.softmax(a_it, axis=1)

        # Weighted sum over time steps
        # (batch, features)
        output = tf.reduce_sum(inputs * tf.expand_dims(alpha, -1), axis=1)

        return output

    def get_config(self):
        config = super().get_config()
        config.update({'units': self.units})
        return config


def create_model(
    num_classes: int = 25,
    window_size: int = WINDOW_SIZE,
    feature_count: int = FEATURE_COUNT,
    lstm_units: Tuple[int, int] = (128, 64),
    dense_units: int = 64,
    dropout_rate: float = 0.3,
    use_attention: bool = True,
) -> Model:
    """
    Create the Bi-LSTM model for ASL gesture recognition.

    Args:
        num_classes: Number of sign classes to predict
        window_size: Number of frames in input sequence
        feature_count: Number of features per frame
        lstm_units: Tuple of (first_lstm_units, second_lstm_units)
        dense_units: Units in the dense layer before output
        dropout_rate: Dropout rate for regularization
        use_attention: Whether to use attention mechanism

    Returns:
        Compiled Keras model
    """
    # Input layer
    inputs = layers.Input(shape=(window_size, feature_count), name='landmarks_input')

    # Masking layer to handle padded sequences
    # Assumes padding is zeros at the beginning
    x = layers.Masking(mask_value=0.0, name='masking')(inputs)

    # First Bi-LSTM layer (return sequences for second LSTM)
    x = layers.Bidirectional(
        layers.LSTM(lstm_units[0], return_sequences=True, name='lstm_1'),
        name='bidirectional_1'
    )(x)
    x = layers.Dropout(dropout_rate, name='dropout_1')(x)

    # Second Bi-LSTM layer
    if use_attention:
        # Return sequences for attention
        x = layers.Bidirectional(
            layers.LSTM(lstm_units[1], return_sequences=True, name='lstm_2'),
            name='bidirectional_2'
        )(x)

        # Attention layer
        x = AttentionLayer(units=lstm_units[1], name='attention')(x)
    else:
        # Don't return sequences - use final state
        x = layers.Bidirectional(
            layers.LSTM(lstm_units[1], return_sequences=False, name='lstm_2'),
            name='bidirectional_2'
        )(x)

    # Dense layer
    x = layers.Dense(dense_units, activation='relu', name='dense_1')(x)
    x = layers.Dropout(dropout_rate, name='dropout_2')(x)

    # Output layer
    outputs = layers.Dense(num_classes, activation='softmax', name='predictions')(x)

    # Create model
    model = Model(inputs=inputs, outputs=outputs, name='asl_lstm_model')

    return model


def create_cnn_lstm_model(
    num_classes: int = 25,
    window_size: int = WINDOW_SIZE,
    feature_count: int = FEATURE_COUNT,
    cnn_filters: int = CNN_FILTERS,
    cnn_kernel_size: int = CNN_KERNEL_SIZE,
    lstm_units: int = LSTM_UNITS,
    dense_units: Tuple[int, int] = tuple(DENSE_UNITS),
    dropout_cnn: float = DROPOUT_CNN,
    dropout_dense_1: float = DROPOUT_DENSE_1,
    dropout_dense_2: float = DROPOUT_DENSE_2,
    use_attention: bool = True,
) -> Model:
    """
    Create the research-grade CNN-LSTM model for ASL gesture recognition.

    Architecture:
        Input (batch, 16, 63)
        → Masking layer
        → Reshape to (batch, 16, 63, 1)
        → TimeDistributed(Conv1D(128, 3, relu)) → BatchNorm → Dropout(0.3)
        → TimeDistributed(Flatten)
        → Bidirectional(LSTM(128, return_sequences=True))  # 256 total units
        → Attention layer
        → Dense(128, relu) → Dropout(0.5)
        → Dense(64, relu) → Dropout(0.3)
        → Dense(num_classes, softmax)

    Args:
        num_classes: Number of sign classes to predict
        window_size: Number of frames in input sequence
        feature_count: Number of features per frame
        cnn_filters: Number of Conv1D filters
        cnn_kernel_size: Conv1D kernel size
        lstm_units: LSTM units (doubled for bidirectional)
        dense_units: Tuple of (first_dense, second_dense) units
        dropout_cnn: Dropout rate after CNN
        dropout_dense_1: Dropout rate after first dense
        dropout_dense_2: Dropout rate after second dense
        use_attention: Whether to use attention mechanism

    Returns:
        Compiled Keras model
    """
    # Input layer
    inputs = layers.Input(shape=(window_size, feature_count), name='landmarks_input')

    # Masking layer for padded sequences
    x = layers.Masking(mask_value=0.0, name='masking')(inputs)

    # Reshape for Conv1D: (batch, time_steps, features) -> (batch, time_steps, features, 1)
    x = layers.Reshape((window_size, feature_count, 1), name='reshape_for_conv')(x)

    # TimeDistributed Conv1D layer - extract spatial features from each frame
    x = layers.TimeDistributed(
        layers.Conv1D(cnn_filters, cnn_kernel_size, activation='relu', padding='same'),
        name='td_conv1d'
    )(x)

    # Batch normalization for training stability
    x = layers.TimeDistributed(layers.BatchNormalization(), name='td_batch_norm')(x)

    # Dropout after CNN
    x = layers.Dropout(dropout_cnn, name='dropout_cnn')(x)

    # Flatten each time step's CNN output
    x = layers.TimeDistributed(layers.Flatten(), name='td_flatten')(x)

    # Bidirectional LSTM with return sequences for attention
    x = layers.Bidirectional(
        layers.LSTM(lstm_units, return_sequences=True, name='lstm'),
        name='bidirectional'
    )(x)

    # Attention layer for weighted temporal aggregation
    if use_attention:
        x = AttentionLayer(units=lstm_units, name='attention')(x)
    else:
        # Global average pooling if no attention
        x = layers.GlobalAveragePooling1D(name='global_avg_pool')(x)

    # Dense layers with dropout
    x = layers.Dense(dense_units[0], activation='relu', name='dense_1')(x)
    x = layers.Dropout(dropout_dense_1, name='dropout_dense_1')(x)

    x = layers.Dense(dense_units[1], activation='relu', name='dense_2')(x)
    x = layers.Dropout(dropout_dense_2, name='dropout_dense_2')(x)

    # Output layer
    outputs = layers.Dense(num_classes, activation='softmax', name='predictions')(x)

    # Create model
    model = Model(inputs=inputs, outputs=outputs, name='asl_cnn_lstm_model')

    return model


def compile_model(
    model: Model,
    learning_rate: float = 0.001,
    label_smoothing: float = 0.1,
) -> Model:
    """
    Compile the model with optimizer and loss.

    Args:
        model: Keras model to compile
        learning_rate: Initial learning rate for Adam optimizer
        label_smoothing: Label smoothing factor for loss

    Returns:
        Compiled model
    """
    optimizer = keras.optimizers.Adam(learning_rate=learning_rate)

    loss = keras.losses.SparseCategoricalCrossentropy(
        from_logits=False,  # We use softmax in the model
    )

    model.compile(
        optimizer=optimizer,
        loss=loss,
        metrics=[
            'accuracy',
            keras.metrics.SparseTopKCategoricalAccuracy(k=3, name='top3_accuracy'),
        ],
    )

    return model


def create_learning_rate_schedule(
    initial_lr: float = 0.001,
    decay_steps: int = 1000,
    alpha: float = 0.1,
) -> keras.optimizers.schedules.LearningRateSchedule:
    """
    Create a cosine decay learning rate schedule.

    Args:
        initial_lr: Initial learning rate
        decay_steps: Number of steps for complete decay
        alpha: Minimum learning rate as fraction of initial

    Returns:
        Learning rate schedule
    """
    return keras.optimizers.schedules.CosineDecay(
        initial_learning_rate=initial_lr,
        decay_steps=decay_steps,
        alpha=alpha,
    )


def get_model_summary(model: Model) -> str:
    """Get model summary as string."""
    summary_list = []
    model.summary(print_fn=lambda x: summary_list.append(x))
    return '\n'.join(summary_list)


def count_parameters(model: Model) -> dict:
    """Count trainable and non-trainable parameters."""
    trainable = sum([tf.reduce_prod(v.shape).numpy() for v in model.trainable_variables])
    non_trainable = sum([tf.reduce_prod(v.shape).numpy() for v in model.non_trainable_variables])

    return {
        'trainable': int(trainable),
        'non_trainable': int(non_trainable),
        'total': int(trainable + non_trainable),
    }


if __name__ == '__main__':
    # Test CNN-LSTM model creation (research-grade)
    print("Creating CNN-LSTM model (research-grade)...")

    model = create_cnn_lstm_model(num_classes=25)
    model = compile_model(model)

    print("\nCNN-LSTM Model Summary:")
    model.summary()

    print("\nParameter Count:")
    params = count_parameters(model)
    print(f"  Trainable: {params['trainable']:,}")
    print(f"  Non-trainable: {params['non_trainable']:,}")
    print(f"  Total: {params['total']:,}")

    # Test forward pass
    print("\nTesting forward pass...")
    dummy_input = tf.random.normal((2, WINDOW_SIZE, FEATURE_COUNT))
    output = model(dummy_input)
    print(f"  Input shape: {dummy_input.shape}")
    print(f"  Output shape: {output.shape}")
    print(f"  Output sum (should be ~1): {tf.reduce_sum(output, axis=-1).numpy()}")

    # Also test legacy model
    print("\n" + "="*60)
    print("Creating legacy Bi-LSTM model...")
    legacy_model = create_model(num_classes=25)
    legacy_params = count_parameters(legacy_model)
    print(f"  Legacy total params: {legacy_params['total']:,}")
    print(f"  CNN-LSTM total params: {params['total']:,}")
