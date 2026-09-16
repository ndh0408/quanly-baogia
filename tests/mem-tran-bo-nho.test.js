/**
 * ============================================================================
 * CỤM mem — TRẦN BỘ NHỚ CỦA CONTAINER, VÀ HEAP CỦA V8 PHẢI ĐI CÙNG NHAU.
 *
 * ── HAI SỐ, MỘT QUYẾT ĐỊNH ─────────────────────────────────────────────────
 * Node KHÔNG đọc trần cgroup để chỉnh heap — nó nới heap theo RAM của HOST. Nên đặt
 * `deploy.resources.limits.memory` mà không đặt `--max-old-space-size` tương ứng là tự bắn vào
 * chân: V8 cứ nới, rồi nhân hệ điều hành SIGKILL NGUYÊN CONTAINER. Lúc đó không phải một request
 * hỏng — mà MỌI request đang bay của MỌI người đứt, SSE đứt, lần Lưu báo giá đang gửi dở mất
 * trắng; `restart: unless-stopped` dựng lại rồi người dùng bấm lại là chết lại.
 *
 * ĐÃ XẢY RA THẬT, đo trên dev: một POST /api/quotes 60.000 dòng (con số hệ thống TỰ QUẢNG CÁO là
 * hợp lệ) →  `oom-kill … Killed process (node) anon-rss 1.529.596 kB`.
 *
 * Đặt heap ở ~2/3 trần thì V8 GC gắt trước rồi ném heap-OOM BẮT ĐƯỢC: errorHandler ghi log và trả
 * 500 cho ĐÚNG MỘT request, container sống tiếp. Đó là khác biệt giữa "một người gặp lỗi" và "cả
 * công ty mất việc đang làm".
 *
 * ── VÌ SAO CẦN CỔNG KIỂM ───────────────────────────────────────────────────
 * Trước bài này, quan hệ giữa hai con số CHỈ tồn tại trong một dòng chú thích. Nâng trần mà quên
 * nâng heap thì phí RAM (im lặng); nâng heap vượt trần thì ĐẢO NGƯỢC thứ tự bảo vệ và đưa hệ
 * thống về đúng chế độ oom-kill ở trên — cũng im lặng, cho tới lần lưu lớn kế tiếp.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = (p) => readFileSync(join(ROOT, p), "utf8");

const FILE_UNG_DUNG = ["docker-compose.prod.yml", "docker-compose.staging.yml"];
const FILE_QUAN_SAT = "infra/observability/docker-compose.observability.yml";

/**
 * Cắt các khối service cấp 1 (`  ten:`) của một file compose.
 *
 * CHỈ trong khối `services:` — `volumes:`, `secrets:` và `networks:` cũng thụt đúng 2 dấu cách,
 * nên quét cả file sẽ nhận `loki-data`, `smtp_password`, `internal`… là "service không có trần
 * bộ nhớ". Bài kiểm đỏ vì lý do sai còn tệ hơn bài kiểm không có: nó dạy người đọc bỏ qua nó.
 */
function catService(noiDung) {
  const dauSv = noiDung.search(/^services:$/m);
  if (dauSv < 0) throw new Error("file compose không có khối services:");
  const sau = noiDung.slice(dauSv + "services:".length);
  const ketThuc = sau.search(/^[a-z]/m); // khoá cấp 0 kế tiếp: volumes:/secrets:/networks:
  noiDung = ketThuc < 0 ? sau : sau.slice(0, ketThuc);

  const ra = {};
  const re = /^ {2}([a-z][\w-]*):$/gm;
  const moc = [...noiDung.matchAll(re)];
  for (let i = 0; i < moc.length; i++) {
    const dau = moc[i].index;
    const cuoi = i + 1 < moc.length ? moc[i + 1].index : noiDung.length;
    ra[moc[i][1]] = noiDung.slice(dau, cuoi);
  }
  return ra;
}

/** `3g` / `1536m` / `512M` → số MB. */
function sangMB(s) {
  const m = /^(\d+(?:\.\d+)?)\s*([gGmM])?b?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return /[gG]/.test(m[2] || "") ? n * 1024 : n;
}

/** Lấy trần bộ nhớ khai trong `deploy.resources.limits`. */
const tranMB = (khoi) => {
  const m = /limits:\s*(?:\n\s*#.*)*\n\s*memory:\s*(\S+)/.exec(khoi);
  return m ? sangMB(m[1]) : null;
};

/** Lấy `--max-old-space-size=N` (MB). */
const heapMB = (khoi) => {
  const m = /--max-old-space-size=(\d+)/.exec(khoi);
  return m ? Number(m[1]) : null;
};

describe("Tiến trình Node: heap V8 phải nằm DƯỚI trần cgroup", () => {
  for (const f of FILE_UNG_DUNG) {
    const sv = catService(doc(f));

    for (const ten of ["app", "worker"]) {
      it(`${f} · ${ten}: khai CẢ trần cgroup LẪN --max-old-space-size`, () => {
        expect(sv[ten], `${f} không có service ${ten}`).toBeTruthy();
        expect(tranMB(sv[ten]), `${ten} không khai deploy.resources.limits.memory`).toBeTruthy();
        // Thiếu cờ này là Node nới heap theo RAM của HOST rồi bị nhân giết cả container.
        expect(heapMB(sv[ten]), `${ten} không khai --max-old-space-size → Node nới heap theo RAM HOST`)
          .toBeTruthy();
      });

      it(`${f} · ${ten}: heap PHẢI nhỏ hơn trần, và ở khoảng 50–75%`, () => {
        const tran = tranMB(sv[ten]);
        const heap = heapMB(sv[ten]);
        // Vế QUAN TRỌNG NHẤT: heap ≥ trần là đảo ngược thứ tự bảo vệ — nhân giết cả container
        // TRƯỚC khi V8 kịp ném lỗi bắt được.
        expect(heap, `${ten}: heap ${heap} MB ≥ trần ${tran} MB → nhân giết cả container, không ai bắt được`)
          .toBeLessThan(tran);
        const ti = heap / tran;
        expect(ti, `${ten}: heap chiếm ${(ti * 100).toFixed(0)}% trần — quá sát, không còn chỗ cho phần ngoài heap (buffer, native, phân mảnh)`)
          .toBeLessThanOrEqual(0.75);
        expect(ti, `${ten}: heap chỉ ${(ti * 100).toFixed(0)}% trần — phí RAM đã trả tiền`)
          .toBeGreaterThanOrEqual(0.5);
      });
    }

    it(`${f}: trần app đủ chỗ cho lần lưu LỚN NHẤT mà hệ thống cho phép`, () => {
      // ĐO ĐƯỢC: 20.000 dòng → đỉnh RSS 756 MB. `MAX_SAVE_TOTAL_ROWS`/`SAVE_BUDGET_ROWS` chặn ở
      // đúng 20.000 dòng TỔNG đang bay, nên 756 MB là chặn trên THẬT của đường lưu. Cộng nền
      // (~136 MB đo trên production lúc rảnh) và chỗ cho một lượt xuất file chạy cùng lúc.
      expect(tranMB(sv.app), "trần app không đủ gấp đôi đỉnh đã đo (756 MB)").toBeGreaterThanOrEqual(1600);
    });
  }

  it("prod và staging dùng CÙNG bộ số — dev phải tái hiện được prod", () => {
    // Hai môi trường lệch trần bộ nhớ thì "đã thử trên dev" không còn nói gì về production, đúng
    // ở chế độ hỏng đắt nhất.
    const [a, b] = FILE_UNG_DUNG.map((f) => catService(doc(f)));
    for (const ten of ["app", "worker"]) {
      expect(tranMB(b[ten]), `${ten}: trần staging khác prod`).toBe(tranMB(a[ten]));
      expect(heapMB(b[ten]), `${ten}: heap staging khác prod`).toBe(heapMB(a[ten]));
    }
  });
});

describe("k8s và Helm cũng phải khai heap — không được là đường triển khai bỏ quên", () => {
  // TRƯỚC bản vá: app/worker trên k8s có `limits: memory 1Gi` và KHÔNG một cờ heap nào. Tức đường
  // triển khai đó được dựng SẴN ở đúng chế độ hỏng mà compose đã phải vá bằng một lần oom-kill
  // thật. Không ai chạy k8s hôm nay, nhưng một manifest dựng sẵn để chết là một cái bẫy đặt cho
  // người sau — và nó sẽ nổ đúng lúc người ta đang di chuyển hệ thống, tức lúc bận nhất.
  const k8s = {
    app: doc("infra/k8s/app.yaml"),
    worker: doc("infra/k8s/worker.yaml"),
  };
  for (const [ten, noiDung] of Object.entries(k8s)) {
    it(`infra/k8s/${ten}.yaml: có heap và heap < limit`, () => {
      const lim = /limits:\s*\{[^}]*memory:\s*(\S+?)\s*\}/.exec(noiDung);
      expect(lim, `${ten}: không khai limits.memory`).toBeTruthy();
      const tran = sangMB(lim[1].replace(/i$/, "")); // 3Gi → 3g
      const heap = heapMB(noiDung);
      expect(heap, `${ten}: không khai NODE_OPTIONS → kubelet OOMKill cả pod`).toBeTruthy();
      expect(heap, `${ten}: heap ${heap} ≥ limit ${tran}`).toBeLessThan(tran);
      expect(heap / tran).toBeLessThanOrEqual(0.75);
    });
  }

  it("Helm: heapMB tồn tại, được template dùng, và nhỏ hơn limits.memory", () => {
    const val = doc("infra/helm/quanly/values.yaml");
    for (const ten of ["app", "worker"]) {
      // CHUỖI THƯỜNG, không phải template literal: trong template literal `\s` là chữ `s`
      // (escape không hợp lệ → chính ký tự đó), nên regex thành `[sS]*?` và không khớp gì.
      const khoi = new RegExp("^" + ten + ":$[\\s\\S]*?(?=^\\w)", "m").exec(val);
      expect(khoi, `values.yaml không có khối ${ten}`).toBeTruthy();
      const lim = /limits:\s*\{[^}]*memory:\s*(\S+?)\s*\}/.exec(khoi[0]);
      const hm = /^\s*heapMB:\s*(\d+)/m.exec(khoi[0]);
      expect(hm, `${ten}: values.yaml thiếu heapMB`).toBeTruthy();
      const tran = sangMB(lim[1].replace(/i$/, ""));
      expect(Number(hm[1]), `${ten}: heapMB ${hm[1]} ≥ limit ${tran}`).toBeLessThan(tran);
      expect(Number(hm[1]) / tran).toBeLessThanOrEqual(0.75);
    }
    // Khai trong values mà template không dùng thì nó chỉ là một con số trang trí.
    expect(doc("infra/helm/quanly/templates/app-deployment.yaml")).toMatch(/max-old-space-size=\{\{ \.Values\.app\.heapMB \}\}/);
    expect(doc("infra/helm/quanly/templates/worker-deployment.yaml")).toMatch(/max-old-space-size=\{\{ \.Values\.worker\.heapMB \}\}/);
  });
});

describe("Ngăn xếp quan sát không được ăn RAM của chính ứng dụng", () => {
  const sv = catService(doc(FILE_QUAN_SAT));

  it("MỌI service đều khai trần bộ nhớ", () => {
    // ĐO ĐƯỢC trên production: trước bản vá này cả 5 container hiện `/ 19.54GiB`, tức KHÔNG có
    // trần — Loki gom log và Prometheus giữ chỉ mục đều phình theo lưu lượng, và chỗ chúng phình
    // vào là RAM mà app/worker đang cần. Một hệ giám sát làm sập thứ nó giám sát là hỏng hai lần.
    const thieu = Object.entries(sv)
      .filter(([, k]) => tranMB(k) === null)
      .map(([t]) => t);
    expect(thieu, `service không có trần bộ nhớ: ${thieu.join(", ")}`).toEqual([]);
  });

  it("tổng trần của phần quan sát không lấn phần ứng dụng", () => {
    // Giám sát là thứ PHỤ. Nó được phép chết để ứng dụng sống, không bao giờ ngược lại.
    const tongQuanSat = Object.values(sv).reduce((t, k) => t + (tranMB(k) || 0), 0);
    const ud = catService(doc("docker-compose.prod.yml"));
    const tongUngDung = (tranMB(ud.app) || 0) + (tranMB(ud.worker) || 0);
    expect(tongQuanSat, `quan sát ${tongQuanSat} MB vs app+worker ${tongUngDung} MB`)
      .toBeLessThan(tongUngDung);
  });
});
