"""Split a searchable transfer copy into deterministic, contiguous PDF page ranges."""
import json
import os
import re
import sys
from pathlib import Path

import fitz


def split(source, directory, max_pages):
    """Preserve PDF page order and text; write an atomic manifest after all parts."""
    root = Path(directory).resolve(strict=True)
    source = Path(source).resolve(strict=True)
    match = re.fullmatch(r"([a-f0-9]{64})\.ocr\.pdf", source.name)
    if source.parent != root or not match or max_pages < 1:
        raise ValueError("Invalid material split request")
    material_hash = match[1]
    parts = []
    with fitz.open(source) as document:
        total = len(document)
        if total <= max_pages:
            raise ValueError("Material does not require splitting")
        for index, start in enumerate(range(0, total, max_pages), 1):
            end = min(start + max_pages, total)
            output = root / f"{material_hash}.part-{index:05d}.pdf"
            temporary = output.with_suffix(".tmp")
            with fitz.open() as part:
                part.insert_pdf(document, from_page=start, to_page=end - 1)
                part.save(temporary, garbage=3, deflate=True, no_new_id=True)
            with fitz.open(temporary) as verified:
                if len(verified) != end - start:
                    raise ValueError("Incomplete PDF part")
                for offset, page in enumerate(verified):
                    if page.get_text() != document[start + offset].get_text():
                        raise ValueError("PDF part text differs from source")
            os.replace(temporary, output)
            parts.append({"pageStart": start + 1, "pageCount": end - start})
            print(json.dumps({"totalPages": total, "completedPages": total}), flush=True)
    manifest = root / f"{material_hash}.parts.json"
    temporary = manifest.with_suffix(".tmp")
    temporary.write_text(json.dumps(parts) + "\n", encoding="utf-8")
    os.replace(temporary, manifest)


if __name__ == "__main__":
    split(sys.argv[1], sys.argv[2], int(sys.argv[3]))
