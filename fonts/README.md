# Fonts for PDF generation

The PDF renderer in `src/pdf.js` looks for these files in this directory:

- `Times.ttf` — regular
- `Times-Bold.ttf` — bold
- `Times-Italic.ttf` — italic

These must be Unicode TTF/OTF files that include Vietnamese diacritic glyphs
(Latin Extended Additional + combining marks).

## Recommended setup

### Windows / WSL dev
Microsoft Times New Roman includes Vietnamese. Copy from `C:\Windows\Fonts`:

```
copy C:\Windows\Fonts\times.ttf   fonts\Times.ttf
copy C:\Windows\Fonts\timesbd.ttf fonts\Times-Bold.ttf
copy C:\Windows\Fonts\timesi.ttf  fonts\Times-Italic.ttf
```

> **License note:** Times New Roman is licensed by Microsoft for use on the
> system it shipped with. For production deploy to Linux containers, use a
> freely redistributable font instead (see below). Do not commit MS fonts
> to a public repo.

### Linux / Docker (recommended for production)

Use **Noto Serif Vietnamese** or **DejaVu Serif** — both freely redistributable.

```bash
# Inside Dockerfile
apt-get install -y fonts-noto-serif fonts-dejavu
# OR mount a font volume / build step:
curl -L https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSerif/full/ttf/NotoSerif-Regular.ttf  -o fonts/Times.ttf
curl -L https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSerif/full/ttf/NotoSerif-Bold.ttf     -o fonts/Times-Bold.ttf
curl -L https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSerif/full/ttf/NotoSerif-Italic.ttf  -o fonts/Times-Italic.ttf
```

## Fallback

If none of these files exist, `src/pdf.js` falls back to PDFKit's built-in
Times font, which **does not** render Vietnamese diacritics correctly.
