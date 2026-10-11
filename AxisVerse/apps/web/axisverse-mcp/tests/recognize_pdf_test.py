"""Verify checkpoint reuse, compact transfers and unchanged original PDF bytes."""
from hashlib import sha256
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

import pymupdf as fitz


class TransferCopyTest(unittest.TestCase):
    def test_completed_checkpoints_skip_ocr_and_preserve_searchable_pages(self):
        with tempfile.TemporaryDirectory(prefix='axisverse-ocr-transfer-') as directory:
            root = Path(directory)
            font = root / 'font.ttf'
            font.write_bytes(fitz.Font('cjk').buffer)
            source = root / ('a' * 64 + '.pdf')
            target = root / 'result.pdf'
            with fitz.open() as original:
                original.new_page(width=400, height=500).insert_text((30, 60), 'Original searchable text')
                scanned = original.new_page(width=400, height=500)
                pixmap = original[0].get_pixmap(matrix=fitz.Matrix(3, 3))
                scanned.insert_image(scanned.rect, pixmap=pixmap)
                original.save(source)
            original_hash = sha256(source.read_bytes()).digest()
            checkpoint = root / ('ocr-' + source.stem)
            checkpoint.mkdir()
            (checkpoint / 'page-00002.json').write_text(json.dumps({
                'width': 400, 'height': 500, 'lines': [{ 'text': 'Recognized checkpoint',
                    'words': [{ 'x': 30, 'y': 40, 'width': 180, 'height': 20 }] }],
            }), encoding='utf-8')
            helper = Path(__file__).resolve().parents[1] / 'recognize-pdf.py'
            command = [sys.executable, str(helper), '--powershell', 'must-not-run',
                '--font', str(font), '--max-side', '1000', '--batch-size', '1',
                '--render-side', '900', '--jpeg-quality', '75', '--max-output-bytes', '1000000',
                '--compression-passes', '3', str(source), str(target), str(root)]
            result = subprocess.run(command,
                check=True, capture_output=True, text=True, timeout=60)
            progress = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertTrue(all(item == {'completedPages': 2, 'totalPages': 2} for item in progress))
            self.assertEqual(sha256(source.read_bytes()).digest(), original_hash)
            self.assertLess(target.stat().st_size, 1000000)
            with fitz.open(source) as before, fitz.open(target) as after:
                self.assertEqual(len(after), 2)
                self.assertEqual(before[0].get_text(), after[0].get_text())
                self.assertIn('Recognized checkpoint', after[1].get_text())
                self.assertEqual(before[1].rect, after[1].rect)
            transfer_hash = sha256(target.read_bytes()).digest()
            subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)
            self.assertEqual(sha256(target.read_bytes()).digest(), transfer_hash)


if __name__ == '__main__':
    unittest.main()
