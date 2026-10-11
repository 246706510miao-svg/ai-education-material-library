"""Checkpoint scanned-page text and produce a compact searchable transfer copy."""
import argparse
import json
from io import BytesIO
from pathlib import Path
import re
import subprocess
import pymupdf as fitz
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--powershell', required=True)
parser.add_argument('--font', required=True)
parser.add_argument('--max-side', type=int, required=True)
parser.add_argument('--batch-size', type=int, required=True)
parser.add_argument('--render-side', type=int, required=True)
parser.add_argument('--jpeg-quality', type=int, required=True)
parser.add_argument('--max-output-bytes', type=int, required=True)
parser.add_argument('--compression-passes', type=int, required=True)
parser.add_argument('source')
parser.add_argument('target')
parser.add_argument('work_root')
args = parser.parse_args()
root = Path(args.work_root).resolve()
source = Path(args.source).resolve()
if (min(args.max_side, args.batch_size, args.render_side, args.max_output_bytes, args.compression_passes) < 1
        or not 1 <= args.jpeg_quality <= 95 or not re.fullmatch(r'[a-f0-9]{64}', source.stem)):
    raise ValueError('Invalid OCR configuration')
work = root / ('ocr-' + source.stem)
if work.is_symlink() or not work.resolve().is_relative_to(root):
    raise ValueError('Invalid OCR checkpoint directory')
work.mkdir(parents=True, exist_ok=True)

def progress(completed, total):
    print(json.dumps({'completedPages': completed, 'totalPages': total}), flush=True)

with fitz.open(source) as doc:
    total = len(doc)
    def has_text(i):
        return bool(doc[i].get_text().strip())

    readable = [has_text(i) for i in range(total)]
    completed = sum(readable[i] or (work / f'page-{i + 1:05}.json').exists() for i in range(total))
    progress(completed, total)
    for start in range(0, total, args.batch_size):
        rendered = False
        for i in range(start, min(start + args.batch_size, total)):
            checkpoint = work / f'page-{i + 1:05}.json'
            if checkpoint.exists() or readable[i]:
                continue
            page = doc[i]
            scale = args.max_side / max(page.rect.width, page.rect.height)
            page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(work / f'page-{i + 1:05}.png')
            rendered = True
        if rendered:
            subprocess.run([args.powershell, '-NoProfile', '-NonInteractive', '-File',
                            str(Path(__file__).with_name('recognize-pages.ps1')), '-Directory', str(work),
                            '-TotalPages', str(total), '-CompletedTextPages', str(sum(readable))], check=True)
        completed = sum(readable[i] or (work / f'page-{i + 1:05}.json').exists() for i in range(total))
        progress(completed, total)
    font = fitz.Font(fontfile=args.font)
    def add_text(page, i):
        data = json.loads((work / f'page-{i + 1:05}.json').read_text(encoding='utf-8-sig'))
        sx, sy = page.rect.width / data['width'], page.rect.height / data['height']
        writer = fitz.TextWriter(page.rect)
        for line in data['lines']:
            words = line['words']
            if not words:
                continue
            text = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', line['text'])
            left = min(word['x'] for word in words)
            right = max(word['x'] + word['width'] for word in words)
            top = min(word['y'] for word in words)
            bottom = max(word['y'] + word['height'] for word in words)
            size = max(1, min((bottom - top) * sy * .82, (right - left) * sx / max(font.text_length(text, fontsize=1), .1)))
            writer.append((left * sx, bottom * sy - size * .15), text, font=font, fontsize=size)
        writer.write_text(page, render_mode=3)
        return sum(len(line['text']) for line in data['lines'])
    candidate = Path(args.target).with_suffix('.candidate.pdf')
    if candidate.parent.resolve() != root or Path(args.target).parent.resolve() != root:
        raise ValueError('Invalid output directory')
    for attempt in range(args.compression_passes):
        transfer = fitz.open()
        characters = 0
        for i, page in enumerate(doc):
            if readable[i]:
                transfer.insert_pdf(doc, from_page=i, to_page=i)
                characters += len(page.get_text())
            else:
                side = max(1, int(args.render_side * .8 ** attempt))
                scale = side / max(page.rect.width, page.rect.height)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                image = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
                stream = BytesIO()
                image.save(stream, format='JPEG', quality=max(1, int(args.jpeg_quality * .8 ** attempt)), optimize=True)
                output_page = transfer.new_page(width=page.rect.width, height=page.rect.height)
                output_page.insert_image(output_page.rect, stream=stream.getvalue())
                characters += add_text(output_page, i)
            progress(total, total)
        if not characters:
            transfer.close()
            raise ValueError('No text recognized')
        transfer.subset_fonts()
        transfer.save(candidate, garbage=4, deflate=True, no_new_id=True)
        transfer.close()
        if candidate.stat().st_size <= args.max_output_bytes:
            candidate.replace(args.target)
            break
        candidate.unlink()
    else:
        raise ValueError('Processed PDF still exceeds transfer limit')
with fitz.open(source) as original, fitz.open(args.target) as result:
    if len(original) != len(result):
        raise ValueError('OCR changed PDF page count')
    for before, after in zip(original, result):
        if before.rect != after.rect:
            raise ValueError('Processing changed PDF page dimensions')
        original_text = before.get_text()
        if original_text.strip() and original_text != after.get_text():
            raise ValueError('Processing changed existing PDF text')
        progress(total, total)
