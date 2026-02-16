import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# export_tfjs imports tensorflow at module import time. These tests only exercise
# metadata helpers, so we provide a lightweight stub when tensorflow is absent.
if 'tensorflow' not in sys.modules:
    tensorflow_stub = types.ModuleType('tensorflow')
    keras_stub = types.ModuleType('keras')
    tensorflow_stub.keras = keras_stub
    sys.modules['tensorflow'] = tensorflow_stub
    sys.modules['tensorflow.keras'] = keras_stub

import export_tfjs  # noqa: E402


class ExportTfjsMetadataUnitTests(unittest.TestCase):
    def test_generate_metadata_uses_current_lstm_defaults(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            metadata = export_tfjs.generate_metadata(Path('/tmp/model.keras'), output_dir)

        self.assertEqual(metadata['inputShape'], [1, 16, 63])
        self.assertEqual(metadata['outputShape'], [1, 25])
        self.assertEqual(metadata['modelFormat'], 'tfjs_layers_model')

    def test_generate_metadata_reads_training_results_and_model_size(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / 'asl_cnn_lstm_25'
            output_dir.mkdir(parents=True, exist_ok=True)

            # Minimal files to trigger model size computation.
            (output_dir / 'model.json').write_text('{"format":"layers-model"}', encoding='utf-8')
            (output_dir / 'group1-shard1of1.bin').write_bytes(b'1234')

            training_results = {
                'vocabulary': ['HELLO', 'THANK_YOU'],
                'num_classes': 2,
                'window_size': 16,
                'feature_count': 63,
                'timestamp': '2026-02-12T00:00:00Z',
                'evaluation': {'test_accuracy': 0.91},
                'best_val_accuracy': 0.93,
            }
            results_path = Path(tmpdir) / 'training_results.json'
            results_path.write_text(json.dumps(training_results), encoding='utf-8')

            metadata = export_tfjs.generate_metadata(
                Path('/tmp/model.keras'),
                output_dir,
                results_path,
            )

        self.assertEqual(metadata['vocabulary'], ['HELLO', 'THANK_YOU'])
        self.assertEqual(metadata['numClasses'], 2)
        self.assertEqual(metadata['windowSize'], 16)
        self.assertEqual(metadata['featureCount'], 63)
        self.assertEqual(metadata['testAccuracy'], 0.91)
        self.assertEqual(metadata['bestValAccuracy'], 0.93)
        self.assertGreater(metadata['modelSizeBytes'], 0)


if __name__ == '__main__':
    unittest.main()
