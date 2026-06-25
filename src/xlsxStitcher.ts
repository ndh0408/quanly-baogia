// Stitch multiple single-sheet xlsx buffers into one multi-sheet xlsx.
//
// Why this exists: ExcelJS's cell-by-cell cross-workbook copy loses style fidelity
// (fonts, themes, fills, image anchors). Stitching at the OOXML/zip level preserves
// each sheet's original styling exactly as if it was the only sheet.
//
// Inputs: array of Buffer (each a complete single-sheet xlsx) + sheet display names.
// Output: Buffer of the combined multi-sheet xlsx.

import JSZip from "jszip";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

interface Rel {
  id: string | undefined;
  type: string | undefined;
  target: string | undefined;
}

async function readStr(zip: JSZip, p: string): Promise<string | null> {
  const f = zip.file(p);
  return f ? await f.async("string") : null;
}

/** Parse the COUNTED list children inside a styles.xml section like <fonts count="N">...</fonts>. */
function extractSection(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return { full: "", inner: "", count: 0, attrs: "" };
  const open = m[0].match(new RegExp(`<${tag}\\b([^>]*)>`));
  const attrs = open ? open[1] : "";
  return { full: m[0], inner: m[1], attrs, count: parseCount(attrs) };
}
function parseCount(attrs: string) {
  const m = attrs.match(/count="(\d+)"/);
  return m ? Number(m[1]) : 0;
}

/** Split a section's inner XML into top-level child elements (e.g. each <font>...</font>). */
function splitChildren(inner: string, childTag: string): string[] {
  if (!inner) return [];
  const out: string[] = [];
  const re = new RegExp(`<${childTag}\\b(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/${childTag}>)`, "g");
  let m;
  while ((m = re.exec(inner)) !== null) out.push(m[0]);
  return out;
}

function buildSection(tag: string, children: string[], extraAttrs = "") {
  const attr = extraAttrs ? ` ${extraAttrs.trim()}` : "";
  return `<${tag} count="${children.length}"${attr}>${children.join("")}</${tag}>`;
}

function replaceSection(xml: string, tag: string, newSectionXml: string) {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`);
  if (re.test(xml)) return xml.replace(re, newSectionXml);
  // No existing section — inject before </styleSheet>
  return xml.replace("</styleSheet>", `${newSectionXml}</styleSheet>`);
}

function ensureXmlDecl(xml: string) {
  return xml.startsWith("<?xml") ? xml : XML_DECL + xml;
}

/**
 * Remap an <xf .../> element's fontId, fillId, borderId, numFmtId by the given offsets.
 * Leaves built-in numFmtIds (< 164) alone.
 */
function remapXf(xfXml: string, fontOff: number, fillOff: number, borderOff: number, numFmtMap: Map<number, number>) {
  let out = xfXml;
  out = out.replace(/fontId="(\d+)"/, (_, n) => `fontId="${Number(n) + fontOff}"`);
  out = out.replace(/fillId="(\d+)"/, (_, n) => `fillId="${Number(n) + fillOff}"`);
  out = out.replace(/borderId="(\d+)"/, (_, n) => `borderId="${Number(n) + borderOff}"`);
  out = out.replace(/numFmtId="(\d+)"/, (_, n) => {
    const id = Number(n);
    if (id < 164) return `numFmtId="${id}"`;
    const mapped = numFmtMap.get(id);
    return mapped != null ? `numFmtId="${mapped}"` : `numFmtId="${id}"`;
  });
  return out;
}

/**
 * Rewrite a sheet XML so its cell style refs (s="N") and shared-string refs
 * (<c t="s"><v>N</v></c>) point to the new indices in the merged workbook.
 */
function remapSheetXml(sheetXml: string, xfOffset: number, sstOffset: number, numFmtMap: Map<number, number>) {
  let out = sheetXml;

  // Cell style: <c r="A1" s="12" ...>  → s="12+xfOffset"
  out = out.replace(/(<c\b[^>]*\bs=")(\d+)(")/g, (_, p1, n, p3) => `${p1}${Number(n) + xfOffset}${p3}`);

  // Row DEFAULT style: <row r="17" s="53" customFormat="1"> → s="53+xfOffset". Columns past
  // the last filled cell inherit this, so if it isn't remapped the row points at the BASE
  // sheet's xf 53 (often a bordered/filled style) → a stray "khung"/nền grid right of the
  // table on stitched sheets. (Same class of bug as cell s=, just on row/col defaults.)
  out = out.replace(/(<row\b[^>]*\bs=")(\d+)(")/g, (_, p1, n, p3) => `${p1}${Number(n) + xfOffset}${p3}`);

  // Column DEFAULT style: <col min=".." max=".." style="N"/> → style="N+xfOffset".
  out = out.replace(/(<col\b[^>]*\bstyle=")(\d+)(")/g, (_, p1, n, p3) => `${p1}${Number(n) + xfOffset}${p3}`);

  // Shared string refs: cells with t="s" reference index in <v>. The cell range
  // looks like <c r="A1" s="12" t="s"><v>5</v></c>. We bump the v.
  if (sstOffset !== 0) {
    out = out.replace(/(<c\b[^>]*\bt="s"[^>]*>\s*<v>)(\d+)(<\/v>)/g,
      (_, p1, n, p3) => `${p1}${Number(n) + sstOffset}${p3}`);
  }

  // numFmtIds appear in cellXfs (handled separately) — not in sheet XML directly.
  // But conditional formatting / data validation may reference style ids; out of scope.
  return out;
}

/** Update <sheets> in workbook.xml: append a new <sheet/> entry. */
function addSheetEntry(wbXml: string, sheetName: string, sheetId: number, rId: string) {
  const entry = `<sheet name="${escapeXmlAttr(sheetName)}" sheetId="${sheetId}" r:id="${rId}"/>`;
  if (/<sheets\s*\/>/.test(wbXml)) {
    return wbXml.replace(/<sheets\s*\/>/, `<sheets>${entry}</sheets>`);
  }
  return wbXml.replace(/(<\/sheets>)/, `${entry}$1`);
}

/** Rename existing sheet entry by 1-based index */
function renameSheet(wbXml: string, idx: number, newName: string) {
  let i = 0;
  return wbXml.replace(/<sheet\b([\s\S]*?)\/>/g, (m, attrs) => {
    i++;
    if (i !== idx) return m;
    const updated = attrs.replace(/name="[^"]*"/, `name="${escapeXmlAttr(newName)}"`);
    return `<sheet${updated}/>`;
  });
}

/** Append a relationship to workbook.xml.rels */
function addRelationship(relsXml: string, rId: string, target: string, type: string) {
  const rel = `<Relationship Id="${rId}" Type="${type}" Target="${target}"/>`;
  return relsXml.replace(/(<\/Relationships>)/, `${rel}$1`);
}

/** Append an override to [Content_Types].xml */
function addOverride(ctXml: string, partName: string, contentType: string) {
  if (ctXml.includes(`PartName="${partName}"`)) return ctXml;
  const ov = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return ctXml.replace(/(<\/Types>)/, `${ov}$1`);
}

function escapeXmlAttr(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function maxNumberInPath(zipNames: string[], dir: string, prefix: string, ext: string) {
  let max = 0;
  for (const n of zipNames) {
    const m = n.match(new RegExp(`^${dir}/${prefix}(\\d+)\\.${ext}$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function parseRels(relsXml: string | null): Rel[] {
  if (!relsXml) return [];
  const rels: Rel[] = [];
  // Match <Relationship ... /> non-greedily up to the self-closing />
  const re = /<Relationship\b([\s\S]*?)\/>/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) {
    const attrs = m[1];
    const id = (attrs.match(/Id="([^"]*)"/) || [])[1];
    const type = (attrs.match(/Type="([^"]*)"/) || [])[1];
    const target = (attrs.match(/Target="([^"]*)"/) || [])[1];
    rels.push({ id, type, target });
  }
  return rels;
}

/**
 * Copy images + drawings from a source xlsx into the base zip, remapping numbers
 * to avoid collisions. Returns the rewritten sheet XML with updated drawing rel IDs.
 *
 * Strategy:
 *   - Each src has worksheets/_rels/sheet1.xml.rels with a Relationship to drawingN.xml
 *   - drawingN.xml references _rels/drawingN.xml.rels which targets media/imageM.png
 *   - We rename drawingN → drawing{baseMax+N}, imageM → image{baseImgMax+M}
 *   - Sheet XML references drawing via r:id (e.g. <drawing r:id="rId1"/>) — those rIds are
 *     local to the sheet's own rels file, which we recreate fresh for the new sheet.
 */
async function copyDrawingsAndImages(srcZip: JSZip, baseZip: JSZip, newSheetNum: number, baseDrawingOffset: number, baseImageOffset: number, srcSheetRelsPath: string) {
  const srcNames = Object.keys(srcZip.files);

  // Sheet rels (drawing reference)
  const srcSheetRels = await readStr(srcZip, srcSheetRelsPath);
  if (!srcSheetRels) return null;
  const sheetRels = parseRels(srcSheetRels);
  // Find drawing relationship inside sheet rels
  const drawingRel = sheetRels.find(r => r.type?.includes("/drawing"));
  if (!drawingRel) return null;

  // drawingTarget e.g. "../drawings/drawing1.xml"
  const drMatch = drawingRel.target?.match(/drawing(\d+)\.xml/);
  if (!drMatch) return null;
  const oldDrNum = Number(drMatch[1]);
  const newDrNum = baseDrawingOffset + oldDrNum;

  // Read drawing xml and its rels
  const oldDrPath = `xl/drawings/drawing${oldDrNum}.xml`;
  const oldDrRelsPath = `xl/drawings/_rels/drawing${oldDrNum}.xml.rels`;
  let drXml = await readStr(srcZip, oldDrPath);
  let drRels = await readStr(srcZip, oldDrRelsPath);
  if (!drXml) return null;

  // Build image remap
  const imageRemap = new Map<number, { newNum: number; ext: string }>(); // oldImgNum -> newImgNum
  if (drRels) {
    const parsed = parseRels(drRels);
    for (const r of parsed) {
      const im = r.target?.match(/image(\d+)\.(png|jpe?g|gif|bmp|emf)/i);
      if (!im) continue;
      const oldNum = Number(im[1]);
      const ext = im[2];
      if (imageRemap.has(oldNum)) continue;
      const newNum = baseImageOffset + oldNum;
      imageRemap.set(oldNum, { newNum, ext });
      // Copy media file
      const oldMediaPath = `xl/media/image${oldNum}.${ext}`;
      const newMediaPath = `xl/media/image${newNum}.${ext}`;
      const mediaFile = srcZip.file(oldMediaPath);
      if (mediaFile) {
        const buf = await mediaFile.async("nodebuffer");
        baseZip.file(newMediaPath, buf);
      }
    }
    // Rewrite drawing rels with new image numbers
    drRels = drRels.replace(/Target="([^"]+)"/g, (full, target) => {
      const im = target.match(/(.*\/)?image(\d+)\.(png|jpe?g|gif|bmp|emf)$/i);
      if (!im) return full;
      const remapped = imageRemap.get(Number(im[2]));
      if (!remapped) return full;
      return `Target="${(im[1] || "")}image${remapped.newNum}.${remapped.ext}"`;
    });
  }

  // Add drawing files to base zip with new numbers
  baseZip.file(`xl/drawings/drawing${newDrNum}.xml`, drXml);
  if (drRels) baseZip.file(`xl/drawings/_rels/drawing${newDrNum}.xml.rels`, drRels);

  return {
    drawingTargetRelative: `../drawings/drawing${newDrNum}.xml`,
    drawingPartName: `/xl/drawings/drawing${newDrNum}.xml`,
    imagePartNames: [...imageRemap.values()].map(x => ({
      partName: `/xl/media/image${x.newNum}.${x.ext}`,
      ext: x.ext.toLowerCase(),
    })),
  };
}

/** Stitch buffers together. First is base. */
export async function stitchXlsxBuffers(buffers: Buffer[], sheetNames: string[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error("Cần ít nhất 1 buffer");
  if (buffers.length === 1) {
    // Single sheet: just rename and return
    if (sheetNames && sheetNames[0]) {
      const z = await JSZip.loadAsync(buffers[0]);
      let wb = await readStr(z, "xl/workbook.xml");
      if (wb) {
        wb = renameSheet(wb, 1, sheetNames[0]);
        z.file("xl/workbook.xml", wb);
      }
      return z.generateAsync({ type: "nodebuffer" });
    }
    return buffers[0];
  }

  const baseZip = await JSZip.loadAsync(buffers[0]);

  // Read base XML parts
  let baseStylesXml = ensureXmlDecl(await readStr(baseZip, "xl/styles.xml") || "");
  let baseSstXml = await readStr(baseZip, "xl/sharedStrings.xml");
  let baseWbXml = await readStr(baseZip, "xl/workbook.xml");
  let baseWbRelsXml = await readStr(baseZip, "xl/_rels/workbook.xml.rels");
  let baseCtXml = await readStr(baseZip, "[Content_Types].xml");

  // These parts are mandatory in any valid xlsx; absence means a malformed base buffer.
  // (Previously these were assumed present and would throw a TypeError when used.)
  if (baseWbXml == null) throw new Error("Base xlsx thiếu xl/workbook.xml");
  if (baseWbRelsXml == null) throw new Error("Base xlsx thiếu xl/_rels/workbook.xml.rels");
  if (baseCtXml == null) throw new Error("Base xlsx thiếu [Content_Types].xml");

  // Rename base's first sheet
  if (sheetNames[0]) baseWbXml = renameSheet(baseWbXml, 1, sheetNames[0]);

  // Style section offsets in base
  const baseFonts = extractSection(baseStylesXml, "fonts");
  const baseFills = extractSection(baseStylesXml, "fills");
  const baseBorders = extractSection(baseStylesXml, "borders");
  const baseCellXfs = extractSection(baseStylesXml, "cellXfs");
  const baseNumFmts = extractSection(baseStylesXml, "numFmts");

  const baseFontsList = splitChildren(baseFonts.inner, "font");
  const baseFillsList = splitChildren(baseFills.inner, "fill");
  const baseBordersList = splitChildren(baseBorders.inner, "border");
  const baseCellXfsList = splitChildren(baseCellXfs.inner, "xf");
  const baseNumFmtsList = splitChildren(baseNumFmts.inner, "numFmt");

  // Find max numFmtId in base
  let nextCustomNumFmtId = 164;
  for (const nf of baseNumFmtsList) {
    const m = nf.match(/numFmtId="(\d+)"/);
    if (m) nextCustomNumFmtId = Math.max(nextCustomNumFmtId, Number(m[1]) + 1);
  }

  // Sharedstrings: parse
  let baseStrings: string[] = [];
  if (baseSstXml) {
    const inner = baseSstXml.match(/<sst\b[^>]*>([\s\S]*?)<\/sst>/);
    if (inner) {
      const sis = inner[1].match(/<si\b[\s\S]*?<\/si>/g) || [];
      baseStrings = sis;
    }
  }

  // Existing sheet count and rel id tracking
  const baseRels = parseRels(baseWbRelsXml || "");
  let baseMaxRId = 0;
  for (const r of baseRels) {
    const m = r.id?.match(/^rId(\d+)$/);
    if (m) baseMaxRId = Math.max(baseMaxRId, Number(m[1]));
  }

  // Offsets for media/drawings to avoid collision with base's own
  let baseDrawingMax = maxNumberInPath(Object.keys(baseZip.files), "xl/drawings", "drawing", "xml");
  let baseImageMax = maxNumberInPath(Object.keys(baseZip.files), "xl/media", "image", "(png|jpe?g|gif|bmp|emf)");

  let baseSheetCount = 1;

  for (let i = 1; i < buffers.length; i++) {
    const srcZip = await JSZip.loadAsync(buffers[i]);
    const srcStylesXml = await readStr(srcZip, "xl/styles.xml") || "";
    const srcSstXml = await readStr(srcZip, "xl/sharedStrings.xml");
    // ExcelJS names the worksheet file by its sheetId (e.g. sheet69.xml), not always sheet1.xml.
    // Locate the actual file from workbook.xml.rels.
    const srcWbRels = await readStr(srcZip, "xl/_rels/workbook.xml.rels") || "";
    const srcSheetRel = parseRels(srcWbRels).find(r => r.type?.includes("/worksheet"));
    const srcSheetPath: string | null = srcSheetRel && srcSheetRel.target != null
      ? `xl/${srcSheetRel.target.replace(/^\/?/, "")}`
      : null;
    const srcSheetXml = srcSheetPath ? await readStr(srcZip, srcSheetPath) : null;
    if (!srcSheetXml || !srcSheetPath) continue;
    // Locate sheet rels file for drawing references
    const srcSheetBase = (srcSheetPath.split("/").pop() ?? srcSheetPath).replace(/\.xml$/, "");
    const srcSheetRelsPath = `xl/worksheets/_rels/${srcSheetBase}.xml.rels`;

    const srcFonts = splitChildren(extractSection(srcStylesXml, "fonts").inner, "font");
    const srcFills = splitChildren(extractSection(srcStylesXml, "fills").inner, "fill");
    const srcBorders = splitChildren(extractSection(srcStylesXml, "borders").inner, "border");
    const srcCellXfs = splitChildren(extractSection(srcStylesXml, "cellXfs").inner, "xf");
    const srcNumFmts = splitChildren(extractSection(srcStylesXml, "numFmts").inner, "numFmt");

    // Style offsets (in base) BEFORE we append
    const fontOff = baseFontsList.length;
    const fillOff = baseFillsList.length;
    const borderOff = baseBordersList.length;
    const xfOff = baseCellXfsList.length;

    // NumFmt remap: source's custom numFmtIds remapped to fresh IDs in base
    const numFmtMap = new Map();
    for (const nf of srcNumFmts) {
      const idM = nf.match(/numFmtId="(\d+)"/);
      if (!idM) continue;
      const oldId = Number(idM[1]);
      if (oldId < 164) continue;
      const newId = nextCustomNumFmtId++;
      numFmtMap.set(oldId, newId);
      baseNumFmtsList.push(nf.replace(/numFmtId="\d+"/, `numFmtId="${newId}"`));
    }

    // Append fonts/fills/borders verbatim
    baseFontsList.push(...srcFonts);
    baseFillsList.push(...srcFills);
    baseBordersList.push(...srcBorders);

    // Append cellXfs with remapped references
    for (const xf of srcCellXfs) {
      baseCellXfsList.push(remapXf(xf, fontOff, fillOff, borderOff, numFmtMap));
    }

    // Source sharedStrings
    let srcStrings: string[] = [];
    if (srcSstXml) {
      const inner = srcSstXml.match(/<sst\b[^>]*>([\s\S]*?)<\/sst>/);
      if (inner) srcStrings = inner[1].match(/<si\b[\s\S]*?<\/si>/g) || [];
    }
    const sstOff = baseStrings.length;
    baseStrings.push(...srcStrings);

    // Remap source sheet XML
    let newSheetXml = remapSheetXml(srcSheetXml, xfOff, sstOff, numFmtMap);

    // Allocate new sheet number, rId
    baseSheetCount++;
    const newSheetNum = baseSheetCount;
    const newRId = `rId${++baseMaxRId}`;
    const newSheetPath = `xl/worksheets/sheet${newSheetNum}.xml`;
    const newSheetRelsPath = `xl/worksheets/_rels/sheet${newSheetNum}.xml.rels`;

    // Drawings/images
    const drInfo = await copyDrawingsAndImages(srcZip, baseZip, newSheetNum, baseDrawingMax, baseImageMax, srcSheetRelsPath);
    let newSheetRelsXml: string | null = null;
    if (drInfo) {
      // Bump global counters by source's max so further sheets don't collide
      const srcMaxDr = maxNumberInPath(Object.keys(srcZip.files), "xl/drawings", "drawing", "xml");
      const srcMaxImg = maxNumberInPath(Object.keys(srcZip.files), "xl/media", "image", "(png|jpe?g|gif|bmp|emf)");
      baseDrawingMax += srcMaxDr;
      baseImageMax += srcMaxImg;

      // Build new sheet rels: a single rId1 → drawing
      newSheetRelsXml = ensureXmlDecl(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="${drInfo.drawingTargetRelative}"/>` +
        `</Relationships>`
      );
      // Ensure sheet xml has <drawing r:id="rId1"/> referencing it
      if (!/<drawing\s+r:id=/.test(newSheetXml)) {
        // Inject before </worksheet>
        newSheetXml = newSheetXml.replace(/<\/worksheet>/, `<drawing r:id="rId1"/></worksheet>`);
      } else {
        // Replace existing rId reference with rId1 (source's was rId1 anyway typically)
        newSheetXml = newSheetXml.replace(/<drawing\s+r:id="[^"]+"\s*\/>/, `<drawing r:id="rId1"/>`);
      }

      // Add content type for drawing + each image (only if not already present)
      baseCtXml = addOverride(baseCtXml, drInfo.drawingPartName,
        "application/vnd.openxmlformats-officedocument.drawing+xml");
      for (const im of drInfo.imagePartNames) {
        // image content types use Default per extension, usually already declared
        const ext = im.ext;
        const ctType = ext === "png" ? "image/png"
          : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "gif" ? "image/gif"
          : ext === "bmp" ? "image/bmp"
          : ext === "emf" ? "image/x-emf"
          : "application/octet-stream";
        if (!new RegExp(`<Default[^>]*Extension="${ext}"`).test(baseCtXml)) {
          baseCtXml = baseCtXml.replace(/(<Types\b[^>]*>)/,
            `$1<Default Extension="${ext}" ContentType="${ctType}"/>`);
        }
      }
    }

    // Write sheet file
    baseZip.file(newSheetPath, ensureXmlDecl(newSheetXml));
    if (newSheetRelsXml) baseZip.file(newSheetRelsPath, newSheetRelsXml);

    // Update workbook.xml: add sheet entry
    baseWbXml = addSheetEntry(baseWbXml, sheetNames[i] || `Sheet${newSheetNum}`, newSheetNum, newRId);

    // Update workbook.xml.rels
    baseWbRelsXml = addRelationship(baseWbRelsXml, newRId, `worksheets/sheet${newSheetNum}.xml`,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet");

    // Update [Content_Types].xml — sheet override
    baseCtXml = addOverride(baseCtXml, `/xl/worksheets/sheet${newSheetNum}.xml`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  }

  // Rebuild styles.xml
  const newFontsXml = buildSection("fonts", baseFontsList, baseFonts.attrs.replace(/count="\d+"/, "").trim());
  const newFillsXml = buildSection("fills", baseFillsList, baseFills.attrs.replace(/count="\d+"/, "").trim());
  const newBordersXml = buildSection("borders", baseBordersList, baseBorders.attrs.replace(/count="\d+"/, "").trim());
  const newCellXfsXml = buildSection("cellXfs", baseCellXfsList, baseCellXfs.attrs.replace(/count="\d+"/, "").trim());

  let newStyles = baseStylesXml;
  newStyles = replaceSection(newStyles, "fonts", newFontsXml);
  newStyles = replaceSection(newStyles, "fills", newFillsXml);
  newStyles = replaceSection(newStyles, "borders", newBordersXml);
  newStyles = replaceSection(newStyles, "cellXfs", newCellXfsXml);
  if (baseNumFmtsList.length > 0) {
    const newNumFmtsXml = buildSection("numFmts", baseNumFmtsList);
    newStyles = replaceSection(newStyles, "numFmts", newNumFmtsXml);
  }
  baseZip.file("xl/styles.xml", newStyles);

  // Rebuild sharedStrings.xml
  if (baseStrings.length > 0) {
    const sstXml = ensureXmlDecl(
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${baseStrings.length}" uniqueCount="${baseStrings.length}">${baseStrings.join("")}</sst>`
    );
    baseZip.file("xl/sharedStrings.xml", sstXml);
    // Ensure content type override exists
    if (!/PartName="\/xl\/sharedStrings.xml"/.test(baseCtXml)) {
      baseCtXml = addOverride(baseCtXml, "/xl/sharedStrings.xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml");
    }
    // Ensure workbook.xml.rels has a sharedStrings rel
    if (!/Target="sharedStrings\.xml"/.test(baseWbRelsXml)) {
      const sstRId = `rId${baseMaxRId + 1}`;
      baseWbRelsXml = addRelationship(baseWbRelsXml, sstRId, "sharedStrings.xml",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings");
    }
  }

  // Renumber sheetIds sequentially (some templates have weird high IDs like sheetId="69"
  // which can confuse Excel when combined with newly-added sheets).
  let sn = 0;
  baseWbXml = baseWbXml.replace(/<sheet\b([\s\S]*?)\/>/g, (m, attrs) => {
    sn++;
    const updated = attrs.replace(/sheetId="\d+"/, `sheetId="${sn}"`);
    return `<sheet${updated}/>`;
  });

  baseZip.file("xl/workbook.xml", baseWbXml);
  baseZip.file("xl/_rels/workbook.xml.rels", baseWbRelsXml);
  baseZip.file("[Content_Types].xml", baseCtXml);

  return baseZip.generateAsync({ type: "nodebuffer" });
}
