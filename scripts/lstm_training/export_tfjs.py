#!/usr/bin/env python3
"""
TensorFlow.js Export Script
Converts trained Keras model to TensorFlow.js format for browser inference.

Features:
- Converts SavedModel to TF.js layers format
- Applies float16 quantization for smaller model size
- Generates metadata for the TypeScript client

Usage:
    python export_tfjs.py --model ./models/run_xxx/final_model --output ../public/models
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Optional
import subprocess

import tensorflow as tf
from tensorflow import keras
import numpy as np


def check_tensorflowjs_installed() -> bool:
    """Check if tensorflowjs_converter CLI is available."""
    return get_tensorflowjs_converter_path() is not None


def get_tensorflowjs_converter_path() -> Optional[str]:
    """Find tensorflowjs_converter executable path."""
    converter_path = shutil.which('tensorflowjs_converter')
    if converter_path:
        return converter_path

    candidates = [
        Path(sys.prefix) / 'bin' / 'tensorflowjs_converter',
        Path(sys.executable).resolve().parent / 'tensorflowjs_converter',
        Path(__file__).resolve().parent / 'venv' / 'bin' / 'tensorflowjs_converter',
    ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return None


def convert_to_tfjs(
    model_path: Path,
    output_dir: Path,
    quantization: str = 'float16',
) -> bool:
    """
    Convert Keras/SavedModel to TensorFlow.js format.

    Args:
        model_path: Path to SavedModel directory or .keras file
        output_dir: Output directory for TF.js files
        quantization: Quantization type ('float16', 'uint8', or None)

    Returns:
        True if successful
    """
    os.makedirs(output_dir, exist_ok=True)

    converter_path = get_tensorflowjs_converter_path()
    if converter_path is None:
        print("tensorflowjs_converter executable not found")
        return False

    # Build conversion command
    cmd = [
        converter_path,
        '--input_format=tf_saved_model',
        '--output_format=tfjs_graph_model',
        '--signature_name=serving_default',
        '--saved_model_tags=serve',
    ]

    # Add quantization
    if quantization:
        cmd.append(f'--quantize_{quantization}=*')

    # Add paths
    cmd.extend([str(model_path), str(output_dir)])

    print(f"Running conversion: {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            print(f"Conversion failed: {result.stderr}")
            return False

        print("Conversion successful!")
        return True

    except subprocess.TimeoutExpired:
        print("Conversion timed out")
        return False
    except Exception as e:
        print(f"Conversion error: {e}")
        return False


def convert_keras_to_tfjs(
    keras_model_path: Path,
    output_dir: Path,
    quantization: str = 'float16',
) -> bool:
    """
    Convert Keras model directly to TF.js layers format.

    Args:
        keras_model_path: Path to .keras file
        output_dir: Output directory for TF.js files
        quantization: Quantization type

    Returns:
        True if successful
    """
    import tensorflowjs as tfjs

    os.makedirs(output_dir, exist_ok=True)

    # Register custom layers before loading
    try:
        from model import AttentionLayer
    except ImportError:
        # Fallback: define minimal AttentionLayer for deserialization
        # when model.py is not on sys.path (e.g. running from a different cwd)
        import tensorflow as _tf

        @_tf.keras.utils.register_keras_serializable(package='Custom')
        class AttentionLayer(_tf.keras.layers.Layer):  # type: ignore[no-redef]
            def __init__(self, units=64, **kwargs):
                super().__init__(**kwargs)
                self.units = units

            def build(self, input_shape):
                feat = input_shape[-1]
                self.W = self.add_weight('attention_weight', (feat, self.units), initializer='glorot_uniform')
                self.b = self.add_weight('attention_bias', (self.units,), initializer='zeros')
                self.u = self.add_weight('attention_context', (self.units,), initializer='glorot_uniform')

            def call(self, inputs):
                score = _tf.nn.tanh(_tf.matmul(inputs, self.W) + self.b)
                alpha = _tf.nn.softmax(_tf.reduce_sum(score * self.u, axis=-1), axis=-1)
                return _tf.reduce_sum(inputs * _tf.expand_dims(alpha, -1), axis=1)

            def get_config(self):
                return {**super().get_config(), 'units': self.units}

    print(f"Loading Keras model: {keras_model_path}")
    model = keras.models.load_model(
        keras_model_path,
        custom_objects={'AttentionLayer': AttentionLayer},
    )

    print(f"Converting to TF.js layers format...")

    # Convert with quantization
    if quantization == 'float16':
        tfjs.converters.save_keras_model(
            model,
            str(output_dir),
            quantization_dtype_map={'float16': '*'},
        )
    elif quantization == 'uint8':
        tfjs.converters.save_keras_model(
            model,
            str(output_dir),
            quantization_dtype_map={'uint8': '*'},
        )
    else:
        tfjs.converters.save_keras_model(model, str(output_dir))

    print("Conversion successful!")
    return True


def generate_metadata(
    model_path: Path,
    output_dir: Path,
    training_results_path: Optional[Path] = None,
) -> dict:
    """
    Generate metadata file for the TF.js model.

    Returns:
        Metadata dictionary
    """
    metadata = {
        'modelFormat': 'tfjs_layers_model',
        'inputShape': [1, 16, 63],
        'outputShape': [1, 25],
    }

    # Load training results if available
    if training_results_path and training_results_path.exists():
        with open(training_results_path, 'r') as f:
            training_results = json.load(f)

        metadata.update({
            'vocabulary': training_results.get('vocabulary', []),
            'numClasses': training_results.get('num_classes', 25),
            'windowSize': training_results.get('window_size', 16),
            'featureCount': training_results.get('feature_count', 63),
            'trainedAt': training_results.get('timestamp'),
            'testAccuracy': training_results.get('evaluation', {}).get('test_accuracy'),
            'bestValAccuracy': training_results.get('best_val_accuracy'),
        })

    # Calculate model size
    model_json_path = output_dir / 'model.json'
    if model_json_path.exists():
        total_size = model_json_path.stat().st_size

        # Add shard files
        for shard_file in output_dir.glob('*.bin'):
            total_size += shard_file.stat().st_size

        metadata['modelSizeBytes'] = total_size
        metadata['modelSizeMB'] = round(total_size / (1024 * 1024), 2)

    return metadata


def verify_conversion(output_dir: Path) -> bool:
    """Verify the conversion was successful."""
    model_json = output_dir / 'model.json'

    if not model_json.exists():
        print("Error: model.json not found")
        return False

    # Check for weight files
    weight_files = list(output_dir.glob('*.bin'))
    if len(weight_files) == 0:
        print("Warning: No weight files (.bin) found")

    # Parse model.json to verify structure
    with open(model_json, 'r') as f:
        model_config = json.load(f)

    if 'modelTopology' not in model_config and 'format' not in model_config:
        print("Error: Invalid model.json structure")
        return False

    print(f"Verification passed:")
    print(f"  - model.json: OK")
    print(f"  - Weight files: {len(weight_files)}")

    return True


def main():
    parser = argparse.ArgumentParser(description='Export model to TensorFlow.js')
    parser.add_argument('--model', type=str, required=True,
                        help='Path to trained model (SavedModel dir or .keras file)')
    parser.add_argument('--output', type=str, default='../public/models',
                        help='Output directory for TF.js model')
    parser.add_argument('--name', type=str, default='asl_cnn_lstm_25',
                        help='Model name (used for output subdirectory)')
    parser.add_argument('--quantization', type=str, default='float16',
                        choices=['float16', 'uint8', 'none'],
                        help='Quantization type for smaller model size')
    parser.add_argument('--training-results', type=str,
                        help='Path to training_results.json for metadata')
    args = parser.parse_args()

    model_path = Path(args.model)
    output_dir = Path(args.output) / args.name

    if not model_path.exists():
        print(f"Error: Model not found: {model_path}")
        return

    # Check dependencies
    if not check_tensorflowjs_installed():
        print("Error: tensorflowjs not installed")
        print("Install with: pip install tensorflowjs")
        return

    print(f"Model path: {model_path}")
    print(f"Output directory: {output_dir}")
    print(f"Quantization: {args.quantization}")

    # Determine model format and convert
    quantization = args.quantization if args.quantization != 'none' else None

    if model_path.suffix == '.keras' or model_path.suffix == '.h5':
        # Keras model file
        success = convert_keras_to_tfjs(model_path, output_dir, quantization)
    elif model_path.is_dir():
        # SavedModel directory
        success = convert_to_tfjs(model_path, output_dir, quantization)
    else:
        print(f"Error: Unknown model format: {model_path}")
        return

    if not success:
        print("Conversion failed!")
        return

    # Verify conversion
    if not verify_conversion(output_dir):
        print("Verification failed!")
        return

    # Generate metadata
    training_results_path = None
    if args.training_results:
        training_results_path = Path(args.training_results)
    elif model_path.parent.name.startswith('run_'):
        # Try to find training_results.json in the same directory
        training_results_path = model_path.parent / 'training_results.json'

    metadata = generate_metadata(model_path, output_dir, training_results_path)

    # Save metadata
    metadata_path = output_dir / 'metadata.json'
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\nMetadata saved to: {metadata_path}")
    print(f"  Vocabulary: {len(metadata.get('vocabulary', []))} signs")
    print(f"  Model size: {metadata.get('modelSizeMB', 'N/A')} MB")

    # Rename model.json to asl_lstm_25.json for the expected path
    model_json_src = output_dir / 'model.json'
    model_json_dst = output_dir.parent / f'{args.name}.json'

    # Copy instead of rename to keep both files
    if model_json_src.exists():
        # For TF.js, we need to update the weightsManifest paths
        with open(model_json_src, 'r') as f:
            model_config = json.load(f)

        # Update weight paths to include subdirectory
        if 'weightsManifest' in model_config:
            for manifest in model_config['weightsManifest']:
                if 'paths' in manifest:
                    manifest['paths'] = [f'{args.name}/{p}' for p in manifest['paths']]

        # Save to parent directory with correct name
        with open(model_json_dst, 'w') as f:
            json.dump(model_config, f)

        print(f"\nModel entry point: {model_json_dst}")

    print(f"\nExport complete!")
    print(f"TF.js model ready at: {output_dir}")
    print(f"\nTo use in the app, ensure LSTM_MODEL_PATH in constants.ts points to:")
    print(f"  '/models/{args.name}.json'")


if __name__ == '__main__':
    main()
