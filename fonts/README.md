# Fonts for PDF generation

The PDF renderer in `src/pdf.ts` looks for these files in this directory:

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

**Image production đã tự làm việc này** — không cần bước tay nào: `Dockerfile` (tầng runtime)
`apk add font-dejavu` rồi chép `DejaVuSerif{,-Bold,-Italic}.ttf` thành `fonts/Times{,-Bold,-Italic}.ttf`.
`scripts/ci/smoke-image.sh` kiểm phông có mặt trong image. (Bản trước của mục này hướng dẫn
`apt-get` — image là alpine, không có apt.)

## Fallback

If none of these files exist, `src/pdf.ts` falls back to PDFKit's built-in
Times font, which **does not** render Vietnamese diacritics correctly.
