#!/usr/bin/env python3
"""Build the self-contained single-file app (index.html)."""
import base64
import pathlib

root = pathlib.Path(__file__).parent
tpl = (root / 'src' / 'template.html').read_text()
css = (root / 'src' / 'style.css').read_text()
app = (root / 'src' / 'app.js').read_text()
# jsPDF is base64-encoded: its source contains HTML-like strings (<html>, <style>,
# <iframe>...) that break naive HTML parsers (e.g. in-app file preview panes).
# Base64 carries no angle brackets, so the payload stays inert until decoded.
jspdf_b64 = base64.b64encode((root / 'vendor' / 'jspdf.umd.min.js').read_bytes()).decode()
qr = base64.b64encode((root / 'assets' / 'qr.png').read_bytes()).decode()
logo = base64.b64encode((root / 'assets' / 'logo.png').read_bytes()).decode()

for token, val in (('__CSS__', css), ('__JSPDFB64__', jspdf_b64),
                   ('__QR__', qr), ('__LOGO__', logo), ('__APP__', app)):
    if token not in tpl:
        raise SystemExit(f'missing placeholder {token}')
    tpl = tpl.replace(token, val)

out = root / 'index.html'
out.write_text(tpl)
print(f'built {out} ({out.stat().st_size/1024:.0f} KB)')
