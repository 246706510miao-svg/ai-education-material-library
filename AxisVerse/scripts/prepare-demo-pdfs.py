"""Build internal searchable teaching copies from the verified demo index."""
import json
from pathlib import Path
import pymupdf

root = Path(__file__).resolve().parents[1]
data = json.loads((root / 'apps/web/axisverse-mcp/data/calculus-demo.json').read_text(encoding='utf-8'))
target = root / 'tmp/demo-materials'
target.mkdir(parents=True, exist_ok=True)
for key, text in [('exam', '\n'.join([data['exam']['title'], data['exam']['source'], '考查模块：', *data['exam']['topics'], data['exam']['question']])),
                  ('solution', '\n'.join([data['solution']['title'], data['exam']['question'], data['solution']['method'], *data['solution']['pitfalls'], data['solution']['verification']]))]:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    # Chinese built-in font embeds an extractable Unicode mapping.
    remaining = page.insert_textbox(pymupdf.Rect(40,40,555,800), text.translate(str.maketrans({'²':'^2','³':'^3','₀':'0','ᶻ':'z'})), fontname='china-s', fontsize=13, lineheight=1.6)
    if remaining < 0:
        raise ValueError('Demo content exceeds page bounds')
    document.save(target / f'{key}.pdf')
    document.close()
    print(f'Created {key}.pdf')
