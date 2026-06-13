// Worker thread: generates the Excel/PDF buffer OFF the main event loop so a
// CPU-heavy export can't freeze the whole app. Receives a JSON-serialized quote
// (plain numbers/strings — structured-clone safe) via workerData, returns the
// buffer to the parent (ArrayBuffer transferred, no copy). Any failure is
// reported back so the caller can fall back to inline generation.
import { parentPort, workerData } from "node:worker_threads";
import { buildQuoteBuffer } from "./excel.js";
import { renderQuotePdf } from "./pdf.js";

(async () => {
  try {
    const { kind, quote } = workerData;
    const buf = kind === "pdf" ? await renderQuotePdf(quote) : await buildQuoteBuffer(quote);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ ok: true, buffer: ab }, [ab]);
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e?.message || String(e) });
  }
})();
