import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

import pandas as pd


SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import prepare_kaggle_data as kaggle  # noqa: E402


class PrepareKaggleDataUnitTests(unittest.TestCase):
    def test_normalize_and_canonical_sign_helpers(self):
        self.assertEqual(kaggle.normalize_sign_token(' thank you '), 'THANK_YOU')
        self.assertEqual(kaggle.canonical_sign_key('THANK-YOU'), 'THANKYOU')

    def test_alias_mapping_resolves_thankyou(self):
        lookup = kaggle.build_target_lookup(kaggle.TARGET_VOCABULARY)
        self.assertEqual(kaggle.map_sign_to_target('thank-you', lookup), 'THANK_YOU')
        self.assertEqual(kaggle.map_sign_to_target('THANKYOU', lookup), 'THANK_YOU')
        self.assertIsNone(kaggle.map_sign_to_target('UNKNOWN_SIGN', lookup))

    def test_sign_stratified_split_preserves_samples(self):
        records = []
        for idx in range(6):
            records.append({'sign': 'HELLO', 'path': f'HELLO/{idx}.npy', 'participant': f'p{idx}'})
            records.append({'sign': 'THANK_YOU', 'path': f'THANK_YOU/{idx}.npy', 'participant': f'p{idx}'})

        splits = kaggle.create_sign_stratified_splits(records, train_ratio=0.7, val_ratio=0.2, seed=42)

        total = sum(len(v) for v in splits.values())
        self.assertEqual(total, len(records))
        self.assertGreater(len(splits['train']), 0)
        self.assertGreater(len(splits['val']), 0)
        self.assertGreater(len(splits['test']), 0)

    def test_participant_split_requires_enough_signers(self):
        few_records = [
            {'sign': 'HELLO', 'path': 'HELLO/a.npy', 'participant': 'p1'},
            {'sign': 'HELLO', 'path': 'HELLO/b.npy', 'participant': 'p2'},
            {'sign': 'THANK_YOU', 'path': 'THANK_YOU/a.npy', 'participant': 'p3'},
        ]
        self.assertIsNone(kaggle.create_participant_splits(few_records, 0.8, 0.1, 42))

    def test_participant_split_builds_non_empty_partitions(self):
        records = []
        participants = [f'p{i}' for i in range(1, 9)]
        for participant in participants:
            records.append({'sign': 'HELLO', 'path': f'HELLO/{participant}.npy', 'participant': participant})
            records.append({'sign': 'THANK_YOU', 'path': f'THANK_YOU/{participant}.npy', 'participant': participant})

        splits = kaggle.create_participant_splits(records, train_ratio=0.6, val_ratio=0.2, seed=42)
        self.assertIsNotNone(splits)
        self.assertGreater(len(splits['train']), 0)
        self.assertGreater(len(splits['val']), 0)
        self.assertGreater(len(splits['test']), 0)

    def test_parquet_to_sequence_extracts_left_and_right_hands(self):
        frame_df = pd.DataFrame(
            [
                {'frame': 10, 'type': 'left_hand', 'landmark_index': 0, 'x': 0.1, 'y': 0.2, 'z': 0.3},
                {'frame': 10, 'type': 'left_hand', 'landmark_index': 1, 'x': 0.4, 'y': 0.5, 'z': 0.6},
                {'frame': 11, 'type': 'right_hand', 'landmark_index': 0, 'x': 0.7, 'y': 0.8, 'z': 0.9},
            ]
        )

        with patch.object(kaggle.pd, 'read_parquet', return_value=frame_df):
            sequence = kaggle.parquet_to_sequence(Path('/tmp/fake.parquet'))

        self.assertIsNotNone(sequence)
        self.assertEqual(sequence.shape[1], 126)
        # Frame 10 becomes index 0 after normalization
        self.assertAlmostEqual(float(sequence[0, 0]), 0.1)
        self.assertAlmostEqual(float(sequence[0, 1]), 0.2)
        self.assertAlmostEqual(float(sequence[0, 2]), 0.3)
        # Right hand wrist at frame 11 -> index 1, right-hand offset starts at 63
        self.assertAlmostEqual(float(sequence[1, 63]), 0.7)
        self.assertAlmostEqual(float(sequence[1, 64]), 0.8)
        self.assertAlmostEqual(float(sequence[1, 65]), 0.9)

    def test_load_custom_vocabulary_normalizes_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vocab_file = Path(tmpdir) / 'vocab.json'
            vocab_file.write_text(json.dumps(['thank you', 'HELLO', 'HELLO', 'no']), encoding='utf-8')

            loaded = kaggle.load_custom_vocabulary(vocab_file)

        self.assertEqual(loaded, ['HELLO', 'NO', 'THANK_YOU'])

    def test_load_custom_vocabulary_rejects_invalid_json_schema(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vocab_file = Path(tmpdir) / 'vocab.json'
            vocab_file.write_text(json.dumps({'vocabulary': ['HELLO']}), encoding='utf-8')

            with self.assertRaises(ValueError):
                kaggle.load_custom_vocabulary(vocab_file)

    def test_has_kaggle_credentials_detects_env_vars(self):
        with patch.dict(os.environ, {'KAGGLE_USERNAME': 'user', 'KAGGLE_KEY': 'key'}, clear=False):
            self.assertTrue(kaggle.has_kaggle_credentials())

    def test_run_command_raises_with_diagnostics_on_failure(self):
        failed = Mock(returncode=1, stdout='stdout text', stderr='stderr text')
        with patch.object(kaggle.subprocess, 'run', return_value=failed):
            with self.assertRaises(RuntimeError) as ctx:
                kaggle.run_command(['echo', 'hello'])

        message = str(ctx.exception)
        self.assertIn('echo hello', message)
        self.assertIn('stdout text', message)
        self.assertIn('stderr text', message)

    def test_main_generates_expected_artifacts_from_synthetic_kaggle_layout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_dir = root / 'kaggle_raw'
            output_dir = root / 'landmarks'
            train_landmark_dir = dataset_dir / 'train_landmark_files'
            train_landmark_dir.mkdir(parents=True, exist_ok=True)

            rows = []
            sequence_id = 0
            participants = [f'P{i}' for i in range(1, 9)]
            for participant in participants:
                for sign in ('HELLO', 'THANK YOU'):
                    rel_path = f'train_landmark_files/{participant}_{sign.replace(" ", "_")}.parquet'
                    parquet_path = dataset_dir / rel_path
                    parquet_path.parent.mkdir(parents=True, exist_ok=True)
                    parquet_path.write_bytes(b'placeholder')

                    rows.append({
                        'sign': sign,
                        'path': rel_path,
                        'participant_id': participant,
                        'sequence_id': sequence_id,
                    })
                    sequence_id += 1

            pd.DataFrame(rows).to_csv(dataset_dir / 'train.csv', index=False)

            frame_df = pd.DataFrame(
                [
                    {'frame': 0, 'type': 'left_hand', 'landmark_index': 0, 'x': 0.1, 'y': 0.2, 'z': 0.3},
                    {'frame': 0, 'type': 'left_hand', 'landmark_index': 1, 'x': 0.4, 'y': 0.5, 'z': 0.6},
                    {'frame': 1, 'type': 'right_hand', 'landmark_index': 0, 'x': 0.7, 'y': 0.8, 'z': 0.9},
                ]
            )

            argv = [
                'prepare_kaggle_data.py',
                '--dataset-dir', str(dataset_dir),
                '--output', str(output_dir),
                '--train-ratio', '0.7',
                '--val-ratio', '0.2',
                '--min-nonzero-frames', '1',
            ]

            with patch.object(kaggle.pd, 'read_parquet', return_value=frame_df), patch.object(sys, 'argv', argv):
                kaggle.main()

            self.assertTrue((output_dir / 'HELLO').exists())
            self.assertTrue((output_dir / 'THANK_YOU').exists())
            self.assertTrue((output_dir / 'splits.json').exists())
            self.assertTrue((output_dir / 'vocabulary.json').exists())
            self.assertTrue((output_dir / 'prepare_stats.json').exists())

            splits = json.loads((output_dir / 'splits.json').read_text(encoding='utf-8'))
            self.assertGreater(len(splits['train']), 0)
            self.assertGreater(len(splits['val']), 0)
            self.assertGreater(len(splits['test']), 0)

            stats = json.loads((output_dir / 'prepare_stats.json').read_text(encoding='utf-8'))
            self.assertEqual(stats['saved_sequences'], len(rows))
            self.assertEqual(stats['split_strategy'], 'participant')


if __name__ == '__main__':
    unittest.main()
