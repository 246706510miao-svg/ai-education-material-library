"""Verify page order, extracted text and stable transfer bytes in isolated files."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import fitz

spec = importlib.util.spec_from_file_location("split_pdf", Path(__file__).parents[1] / "split-pdf.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class SplitPdfTests(unittest.TestCase):
    def test_preserves_all_pages_and_text_with_repeatable_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            material_hash = "a" * 64
            source = root / f"{material_hash}.ocr.pdf"
            with fitz.open() as document:
                for index in range(3):
                    document.new_page().insert_text((40, 40), f"Original page {index + 1}")
                document.save(source)
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            helper.split(source, root, 2)
            self.assertEqual(json.loads((root / f"{material_hash}.parts.json").read_text()),
                             [{"pageStart": 1, "pageCount": 2}, {"pageStart": 3, "pageCount": 1}])
            files = sorted(root.glob("*.part-*.pdf"))
            text = []
            for file in files:
                with fitz.open(file) as document:
                    text.extend(page.get_text().strip() for page in document)
            self.assertEqual(text, ["Original page 1", "Original page 2", "Original page 3"])
            hashes = [hashlib.sha256(file.read_bytes()).hexdigest() for file in files]
            helper.split(source, root, 2)
            self.assertEqual(hashes, [hashlib.sha256(file.read_bytes()).hexdigest() for file in files])
            self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())
            with self.assertRaises(ValueError):
                helper.split(source, root, 3)
            with self.assertRaises(ValueError):
                helper.split(source, root.parent, 2)


if __name__ == "__main__":
    unittest.main()
