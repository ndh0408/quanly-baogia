// Excel/PDF generation is CPU-bound and (without a Redis worker) runs inline on
// the single event-loop thread. Serialize it so a BURST of exports queues one at
// a time instead of piling up several multi-MB buffers + interleaved CPU blocks
// at once. They can't truly run in parallel on one thread anyway, so serial is
// strictly better for memory + tail latency. A small cap rejects (429) once the
// queue is too deep, so the app degrades gracefully instead of timing out.
let chain = Promise.resolve();
let pending = 0;
const MAX_PENDING = 8;

export async function runExport(fn) {
  if (pending >= MAX_PENDING) {
    throw Object.assign(new Error("Hệ thống đang bận xuất file, vui lòng thử lại sau"), { status: 429 });
  }
  pending++;
  // Run after the previous job settles (success OR failure — never block the chain).
  const result = chain.then(fn, fn);
  chain = result.then(() => {}, () => {});
  try {
    return await result;
  } finally {
    pending--;
  }
}
