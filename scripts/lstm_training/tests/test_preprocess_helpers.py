import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import preprocess  # noqa: E402


class PreprocessHelpersUnitTests(unittest.TestCase):
    def test_load_vocabulary_prefers_vocabulary_json_order(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / 'HELLO').mkdir()
            (root / 'THANK_YOU').mkdir()
            (root / 'NO').mkdir()

            (root / 'vocabulary.json').write_text(
                json.dumps({'vocabulary': ['THANK_YOU', 'HELLO', 'MISSING', 'NO']}),
                encoding='utf-8',
            )

            vocab = preprocess.load_vocabulary_from_input(root)

        self.assertEqual(vocab, ['THANK_YOU', 'HELLO', 'NO'])

    def test_load_vocabulary_falls_back_to_sorted_dirs_when_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / 'THANK_YOU').mkdir()
            (root / 'HELLO').mkdir()

            vocab = preprocess.load_vocabulary_from_input(root)

        self.assertEqual(vocab, ['HELLO', 'THANK_YOU'])

    def test_load_vocabulary_falls_back_on_invalid_payload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / 'THANK_YOU').mkdir()
            (root / 'HELLO').mkdir()

            (root / 'vocabulary.json').write_text(
                json.dumps({'unexpected': ['THANK_YOU']}),
                encoding='utf-8',
            )

            vocab = preprocess.load_vocabulary_from_input(root)

        self.assertEqual(vocab, ['HELLO', 'THANK_YOU'])


if __name__ == '__main__':
    unittest.main()
