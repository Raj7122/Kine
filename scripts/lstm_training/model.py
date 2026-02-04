#!/usr/bin/env python3
"""
LSTM Model Architecture for ASL Dynamic Gesture Recognition

Architecture:
    Input: (batch, 32, 126) - 32 frames, 126 features per frame
    Masking -> Bi-LSTM(128) -> Dropout -> Bi-LSTM(64) -> Attention -> Dense -> Softmax

Usage:
    from model import create_model
    model = create_model(num_classes=25)
"""

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model
from typing import Tuple, Optional


# Constants (must match TypeScript config)
WINDOW_SIZE = 32
FEATURE_COUNT = 126


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
    # Test model creation
    print("Creating model...")

    model = create_model(num_classes=25)
    model = compile_model(model)

    print("\nModel Summary:")
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
