// THANH NÚT DÍNH ĐÁY CỦA MÀN SOẠN BÁO GIÁ — khoá LUẬT CSS để lỗi "nút Lưu đè nhóm + Thêm hàng…" không quay lại.
//
// LỖI (chủ repo 2026-09-30, đo ở 1367×800): khối `@media (max-height: 820px), (max-width: 860px)` ép `.editor .actions` thành nowrap,
// trong khi `.grid-add-bar` vẫn mang `min-width: 0` (co được) và KHÔNG có `overflow`. Trong MỘT hàng nowrap nó là phần tử duy nhất co
// được: thiếu chỗ thì hộp co còn ~290px, năm nút bên trong (nowrap, không co) TRÀN ra ngoài hộp và bị Lưu / Khách chốt vẽ đè lên.
// "Chiều cao ≤ 820px" lại khớp hầu hết laptop (1366×768, FHD 125% = 1536×864, FHD 150% = 1280×720) — còn CI chạy ở 1440×900 nên chưa
// bao giờ vào nhánh đó. Đo thật: đè 116px ở 1366×768, 58px ở 1280×720, 44px ở 1536×730, và hỏng cả điện thoại.
//
// jsdom không dàn trang, nên bài này KHÔNG chứng minh được "không đè" bằng hình học (việc đó do bước [U13b] của scripts/ci/ui-smoke.mjs
// làm trên Chromium thật). Nó giải CASCADE thật (public/style.css rồi styles.css — cùng thứ tự nạp, độ ưu tiên bộ chọn, khối @media theo
// cỡ cửa sổ) rồi khoá các BẤT BIẾN mà mọi cách sửa đúng đều phải giữ:
//   1. một hàng nowrap mà nhóm thêm còn co được thì nhóm thêm PHẢI là khung cuộn/cắt (không được để nút tràn ra ngoài hộp) — đúng công
//      thức của lỗi, kiểm ở MỌI bề rộng từ 320px tới 3840px;
//   2. KHÔNG còn điều kiện theo CHIỀU CAO cửa sổ trên thanh (nguồn gốc khiến lỗi chỉ lộ ở laptop);
//   3. bốn lớp bố cục (≥1240 một hàng · 641–1239 hai hàng · ≤640 dải cuộn) và các mốc nén, với phép tính dư chỗ từ số đo thật.
import { describe, it, expect } from "vitest";
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const doc = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const CSS = [doc("../../public/style.css"), doc("./styles.css")].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

type Rule = { chon: string[]; media: string | null; khai: string; thuTu: number };
/** Tách rule theo cấp: rule CẤP ĐẦU (media = null) và rule nằm trong `@media …` (cùng bộ tách với styles.hopNhapExcel.test.ts). */
function tachRule(css: string): Rule[] {
  const out: Rule[] = [];
  let thuTu = 0;
  const khoi = (tu: number) => { let sau = 1, j = tu; for (; j < css.length && sau; j++) { if (css[j] === "{") sau++; else if (css[j] === "}") sau--; } return j; };
  const docRule = (tu: number, den: number, media: string | null) => {
    let k = tu;
    while (k < den) {
      const mo = css.indexOf("{", k);
      if (mo < 0 || mo >= den) break;
      const dau = css.slice(k, mo).trim();
      const dong = khoi(mo + 1);
      if (dau.startsWith("@media") && media == null) docRule(mo + 1, dong - 1, dau.slice(6).trim());
      else if (!dau.startsWith("@")) out.push({ chon: dau.split(",").map((x) => x.trim().replace(/\s+/g, " ")), media, khai: css.slice(mo + 1, dong - 1), thuTu: thuTu++ });
      k = dong;
    }
  };
  docRule(0, css.length, null);
  return out;
}
const RULES = tachRule(CSS);

/** Điều kiện @media có khớp cửa sổ `w`×`h` không. Hiểu min/max-width, min/max-height, `and`, và dấu phẩy (= HOẶC); điều kiện khác
 *  (prefers-color-scheme, print…) coi là KHÔNG khớp. Bản cũ chỉ hiểu max/min-width nên `(max-height: 820px)` — chính cái gây lỗi —
 *  bị bỏ qua im lặng. */
function khopMedia(q: string, w: number, h: number): boolean {
  return q.split(",").some((phan) => {
    const dk = [...phan.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    if (!dk.length) return false;
    return dk.every((d) => {
      const m = /^(max|min)-(width|height):\s*([\d.]+)px$/.exec(d);
      if (!m) return false;
      const v = m[2] === "width" ? w : h;
      return m[1] === "max" ? v <= +m[3] : v >= +m[3];
    });
  });
}
const doUuTien = (chon: string) => (chon.match(/\.[\w-]+/g) || []).length;

/** Giá trị THẮNG CUỐI CÙNG của `prop` cho phần tử khớp các bộ chọn `chon` ở cửa sổ `w`×`h` (độ ưu tiên bộ chọn, rồi thứ tự nạp). */
function thang(chon: string[], prop: string, w: number, h = 900): string | null {
  let tot: { v: string; uu: number; thuTu: number } | null = null;
  for (const r of RULES) {
    if (r.media != null && !khopMedia(r.media, w, h)) continue;
    const trung = r.chon.filter((c) => chon.includes(c));
    if (!trung.length) continue;
    const d = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`).exec(r.khai);
    if (!d) continue;
    const quanTrong = /!important/.test(d[1]);
    const uu = Math.max(...trung.map(doUuTien)) + (quanTrong ? 1000 : 0);
    if (!tot || uu > tot.uu || (uu === tot.uu && r.thuTu > tot.thuTu)) tot = { v: d[1].replace(/!important/, "").trim(), uu, thuTu: r.thuTu };
  }
  return tot?.v ?? null;
}

const THANH = [".editor .actions"];
const NHOM_THEM = [".grid-add-bar", ".editor .actions .grid-add-bar"];
const NUT_HANH_DONG = [".editor .actions > .btn", ".editor .actions > .kebab-wrap"];
/** Bề rộng thanh = bề rộng cửa sổ − 371px (sidebar 240px + lề) khi có sidebar, tới ~2570px (sau đó trần 2200px): số đo trên trang soạn. */
const SIDEBAR_VA_LE = 371;

// Bề rộng TỰ NHIÊN của cả thanh (báo giá nháp — đầy đủ nhất: Lưu · Khách chốt · Khách không chốt · ⋯), ĐO bằng getBoundingClientRect
// trên Chromium thật ở từng mức nén (nhãn "Báo giá chính"). Nhãn dài hơn ("Báo giá Hà Nội") thêm ~20px ở hai mức đầu.
// Hai số sau đo 2026-10-06: nhan64 = nén + biểu tượng + nhãn 64px + đệm nút thêm 6px; nenHep = nấc 1280–1365 (nhãn 52px, khoảng cách
// 5px, đệm 7px…) — suy từ số đo ở 1280 bằng Chromium có thanh cuộn THẬT (thanh 899px, vừa khít; bản 6px/8px còn khuất 3px).
const TU_NHIEN = { dayDu: 1271, nen: 1074, nenBieuTuong: 1003, nhan64: 956, nenHep: 895 };

describe("thanh đáy màn soạn — bất biến chống chồng nút", () => {
  it("CHỐNG RỖNG: bộ giải cascade đọc đúng các luật của thanh (không phải xanh vì không thấy gì)", () => {
    expect(RULES.some((r) => r.chon.includes(".editor .actions") && r.media === null), "mất luật nền của thanh").toBe(true);
    expect(thang(THANH, "flex-wrap", 1366)).toBe("nowrap");
    expect(thang(THANH, "flex-wrap", 1000)).toBe("wrap");
    expect(thang(NHOM_THEM, "overflow-x", 1366)).toBe("auto");
  });

  it("KHÔNG còn điều kiện theo CHIỀU CAO cửa sổ trên thanh — nguồn gốc khiến lỗi chỉ lộ ở laptop và CI (1440×900) không thấy", () => {
    const dinhTheoCao = RULES.filter((r) => r.media != null && /(min|max)-height/.test(r.media) && r.chon.some((c) => /\.editor \.actions|\.grid-add-bar|\.dock-nhan|\.gf-venue-pick/.test(c)));
    expect(dinhTheoCao.map((r) => `${r.media} → ${r.chon.join(", ")}`)).toEqual([]);
  });

  it("đổi chiều cao cửa sổ KHÔNG đổi bố cục thanh (cùng bề rộng, nhiều chiều cao)", () => {
    for (const w of [700, 1100, 1280, 1366, 1440, 1536, 1920, 2560]) {
      const dong = (h: number) => [thang(THANH, "flex-wrap", w, h), thang(NHOM_THEM, "overflow-x", w, h), thang(NHOM_THEM, "min-width", w, h), thang(NHOM_THEM, "flex", w, h)].join("|");
      for (const h of [400, 600, 720, 768, 820, 821, 900, 1080, 1440]) expect(dong(h), `${w}×${h} khác ${w}×900`).toBe(dong(900));
    }
  });

  it("CÔNG THỨC CỦA LỖI, ở MỌI bề rộng 320–3840px: thanh nowrap + nhóm thêm còn co được (shrink>0, min-width:0) thì nhóm thêm PHẢI cắt/cuộn — không được để nút tràn ra ngoài hộp", () => {
    const loi: string[] = [];
    const moc = [...Array.from({ length: 353 }, (_, i) => 320 + i * 10), 640, 640.5, 641, 860, 861, 1239, 1240, 1279, 1279.5, 1280, 1365, 1366, 1419, 1420, 1479, 1480, 1699, 1700];
    for (const w of moc) {
      const nowrap = thang(THANH, "flex-wrap", w) === "nowrap";
      const flex = (thang(NHOM_THEM, "flex", w) ?? "0 1 auto").trim().split(/\s+/);   // grow shrink basis
      const coDuoiNoiDung = Number(flex.length >= 2 ? flex[1] : 1) > 0 && ["0", "0px"].includes((thang(NHOM_THEM, "min-width", w) ?? "auto").trim());
      const ovx = (thang(NHOM_THEM, "overflow-x", w) ?? "visible").trim();
      if (nowrap && coDuoiNoiDung && ovx === "visible") loi.push(`${w}px: thanh nowrap, nhóm thêm co được (flex ${flex.join(" ")}) mà overflow-x = ${ovx} → nút tràn đè Lưu`);
    }
    expect(loi).toEqual([]);
  });

  it("MỌI bề rộng 320–3840px (bước 0,25px — zoom trình duyệt / tỉ lệ Windows cho bề rộng LẺ) rơi vào ĐÚNG MỘT lớp bố cục", () => {
    // Bản đầu ghép đôi max-width 1239px / min-width 1240px: bề rộng 1239,5 (1366px ở zoom 110% = 1241,8 — cùng họ) lọt GIỮA, không lớp
    // nào áp. Nay mốc dưới dùng .98px. Ba lớp nhận diện bằng thứ CHỈ lớp đó có.
    // "Lớp nào áp" chỉ đổi giá trị ở MỐC của các @media — thử sát hai bên mọi mốc (±0,02 / ±0,25 / ±0,5px) cộng một điểm giữa mỗi khoảng
    // là phủ HẾT mọi bề rộng thực. (Bản quét đều 0,25px — ~14 nghìn lần giải cascade — chạy quá 5s khi cả bộ test chạy song song.)
    // KHÔNG thử ±0,01: khe 0,02px giữa 640,98 và 641 là quy ước .98 có chủ ý (Bootstrap dùng y hệt) — bề rộng lẻ do zoom là N/z với N
    // nguyên, ở các mức zoom × tỉ lệ Windows thật (0,8…3) không N nào rơi vào khe đó; còn cú pháp `(width < 641px)` thì Safari < 16.4 bỏ qua.
    const moc = new Set<number>();
    for (const r of RULES) if (r.media) for (const m of r.media.matchAll(/(?:min|max)-width:\s*([\d.]+)px/g)) moc.add(+m[1]);
    const dsMoc = [...moc].filter((b) => b >= 320 && b <= 3840).sort((a, b) => a - b);
    const thu = new Set<number>([320, 3840]);
    for (const b of dsMoc) for (const d of [-0.5, -0.25, -0.02, 0, 0.02, 0.25, 0.5]) thu.add(+(b + d).toFixed(2));
    for (let i = 0; i + 1 < dsMoc.length; i++) if (dsMoc[i + 1] - dsMoc[i] > 0.05) thu.add((dsMoc[i] + dsMoc[i + 1]) / 2);   // trừ khe .98
    expect(dsMoc, "phải đọc được các mốc .98 của thanh").toEqual(expect.arrayContaining([640.98, 641, 1279.98, 1280]));
    const loi: string[] = [];
    for (const w of [...thu].sort((a, b) => a - b)) {
      const dai = thang(THANH, "overflow-x", w) === "auto";                         // ≤640.98: cả thanh là dải cuộn
      const haiHang = thang([".editor .actions::after"], "content", w) === '""';    // 641–1279.98: phần tử giả ngắt dòng
      const motHang = thang(NHOM_THEM, "overflow-x", w) === "auto";                 // ≥1280: nhóm thêm là khung cuộn riêng
      const so = [dai, haiHang, motHang].filter(Boolean).length;
      if (so !== 1) loi.push(`${w}px: ${so} lớp áp (dải ${dai}, hai hàng ${haiHang}, một hàng ${motHang})`);
    }
    expect(loi).toEqual([]);
  });

  it("≥ 1280px: MỘT hàng — nhóm thêm là khung cuộn ngang riêng (chừa đệm cho vòng focus), nhóm hành động KHÔNG co", () => {
    for (const w of [1280, 1300, 1365, 1366, 1440, 1536, 1600, 1699, 1700, 1920, 2048, 2560, 3840]) {
      expect(thang(THANH, "flex-wrap", w), `${w}px`).toBe("nowrap");
      expect(thang(NHOM_THEM, "overflow-x", w), `${w}px`).toBe("auto");
      expect(thang(NHOM_THEM, "flex-wrap", w), `${w}px`).toBe("nowrap");
      expect(thang(NHOM_THEM, "min-width", w), `${w}px: nhóm thêm phải co được`).toBe("0");
      expect(thang([".editor .actions .btn"], "flex", w), `${w}px: nút không co`).toBe("0 0 auto");
      expect(thang([".editor .actions .dock-nhan"], "flex", w), `${w}px: nhãn không co`).toBe("0 0 auto");
      expect(thang([".editor .actions .kebab-wrap"], "flex", w), `${w}px: ⋯ không co`).toBe("0 0 auto");
      expect(thang(NUT_HANH_DONG, "order", w), `${w}px: không xếp lại thứ tự ở màn rộng`).toBeNull();
      expect(thang([".editor .actions::after"], "content", w), `${w}px: không có phần tử giả ngắt dòng`).toBeNull();
    }
    // Khung cuộn cắt cả vòng focus (outline 2px + offset 2px = 4px): đệm 4px, bù lề âm để không đổi chỗ các nút.
    expect(thang([".editor .actions .grid-add-bar"], "padding", 1366)).toBe("4px");
    expect(thang([".editor .actions .grid-add-bar"], "margin", 1366)).toBe("-4px");
  });

  it("641–1279px: HAI hàng — phần tử giả 100% ngắt dòng sau nhóm trái, nhóm hành động xuống hàng hai nguyên khối (không bị tách Lưu ở hàng trên)", () => {
    // Mốc 1280 (không phải 1240): đo lại với thanh cuộn thật, 1240–1279 một hàng thì khuất 23–43px nhóm thêm ("⌨️" mất hẳn).
    for (const w of [641, 768, 900, 1024, 1152, 1239, 1240, 1260, 1279, 1279.5]) {
      expect(thang(THANH, "flex-wrap", w), `${w}px`).toBe("wrap");
      expect(thang([".editor .actions::after"], "content", w), `${w}px`).toBe('""');
      expect(thang([".editor .actions::after"], "flex", w), `${w}px`).toBe("0 0 100%");
      expect(thang([".editor .actions::after"], "order", w), `${w}px`).toBe("1");
      expect(thang(NUT_HANH_DONG, "order", w), `${w}px: nhóm hành động phải đứng SAU phần tử giả`).toBe("2");
      expect(thang(THANH, "row-gap", w), `${w}px: phần tử giả là một dòng cao 0 — để row-gap thì cộng thừa`).toBe("0");
      expect(thang(NHOM_THEM, "overflow-x", w), `${w}px: hai hàng thì nhóm thêm hiện đủ, không cuộn`).toBeNull();
    }
  });

  it("≤ 640px: dải cuộn ngang MỘT hàng, các nhóm KHÔNG co, nhóm hành động đứng ĐẦU (Lưu luôn thấy ngay)", () => {
    for (const w of [320, 360, 390, 412, 600, 640, 640.5]) {
      expect(thang(THANH, "flex-wrap", w), `${w}px`).toBe("nowrap");
      expect(thang(THANH, "overflow-x", w), `${w}px`).toBe("auto");
      expect(thang(NHOM_THEM, "flex", w), `${w}px: nhóm thêm không co`).toBe("0 0 auto");
      expect(thang(NHOM_THEM, "min-width", w), `${w}px`).toBe("auto");
      expect(thang([".editor .actions .btn"], "flex", w), `${w}px`).toBe("0 0 auto");
      expect(thang(NUT_HANH_DONG, "order", w), `${w}px: nhóm hành động phải đứng đầu dải`).toBe("-1");
      expect(thang([".editor .actions > .btn.btn-primary"], "margin-left", w), `${w}px`).toBe("0");
      expect(thang([".editor .actions::after"], "content", w), `${w}px`).toBeNull();
    }
  });

  it("các mốc nén đúng chỗ: chữ dẫn ẩn ≤1699 · 'Chèn từ rạp' chỉ còn biểu tượng ≤1479 (chữ vẫn trong DOM) · nhãn cắt 64px ≤1419", () => {
    const an = (w: number) => thang([".dock-nhan-dan"], "display", w);
    expect(an(1700)).toBeNull();
    expect(an(1699)).toBe("none");
    expect(an(1366)).toBe("none");
    const cỡ = (w: number) => thang([".editor .actions .grid-add-bar .gf-venue-pick"], "font-size", w);
    expect(cỡ(1480)).toBeNull();
    expect(cỡ(1479)).toBe("0");   // font-size: 0, KHÔNG display:none — tên truy cập và test theo chữ vẫn nguyên
    expect(thang([".editor .actions .grid-add-bar .gf-venue-pick::before"], "content", 1479)).toBe('"📐"');
    expect(thang([".editor .actions .grid-add-bar .gf-venue-pick::before"], "content", 1480)).toBeNull();
    const tran = (w: number) => thang([".editor .actions .dock-nhan"], "max-width", w);
    expect(tran(1420)).toBeNull();
    expect(tran(1419)).toBe("64px");
    expect(tran(1366)).toBe("64px");
    expect(tran(1365), "nấc 1280–1365 (1280×720 = FHD 150%)").toBe("52px");
    expect(tran(1280)).toBe("52px");
    // Trần nhãn CHỈ ở lớp một hàng: ở lớp hai hàng hàng trên còn dư chỗ; ở dải điện thoại nhãn overflow:visible nên cái trần để chữ tràn
    // ra ngoài hộp, chui dưới "+ Thêm hàng" (đo 2026-10-06: 'Báo giá chín' đè 7px ở 360/390/412/640).
    for (const w of [1279, 1240, 1024, 768, 641, 640, 390, 360]) expect(tran(w), `${w}px`).toBeNull();
    // Không có luật nào ẩn HẲN nút (display:none) trên thanh ở bất kỳ cỡ nào — người dùng đã phàn nàn chuyện "không thấy hết".
    const anNut = RULES.filter((r) => r.chon.some((c) => /\.editor \.actions/.test(c) && !/dock-nhan-dan/.test(c)) && /(^|[;\s])display:\s*none/.test(r.khai));
    expect(anNut.map((r) => r.chon.join(","))).toEqual([]);
  });

  it("PHÉP TÍNH DƯ CHỖ từ số đo thật: ở cỡ NHỎ NHẤT của mỗi mức nén, cả thanh vẫn vừa một hàng mà không phải cuộn", () => {
    const thanh = (vw: number) => vw - SIDEBAR_VA_LE;
    // Mốc ĐỌC TỪ CSS (không gõ cứng): cỡ nhỏ nhất mà mỗi mức còn hiệu lực. Đổi mốc trong CSS thì bài này tính lại theo.
    // Tìm từ 1280 (đầu lớp MỘT hàng): ở lớp hai hàng nhãn không có trần nên "trần = null" ở đó không mang nghĩa mức nén nào.
    const nhoNhat = (kiem: (w: number) => boolean) => { for (let w = 1280; w <= 2600; w++) if (kiem(w)) return w; throw new Error("không có mốc"); };
    const dayDu = nhoNhat((w) => thang([".dock-nhan-dan"], "display", w) === null);                                          // chữ dẫn hiện lại
    const nen = nhoNhat((w) => thang([".editor .actions .grid-add-bar .gf-venue-pick"], "font-size", w) === null);        // "Chèn từ rạp" còn chữ
    const bieuTuong = nhoNhat((w) => thang([".editor .actions .dock-nhan"], "max-width", w) === null);                    // nhãn chưa bị cắt 64px
    const bieuTuongNhan64 = nhoNhat((w) => thang([".editor .actions .dock-nhan"], "max-width", w) === "64px");            // hết nấc 52px
    expect([dayDu, nen, bieuTuong, bieuTuongNhan64], "mốc đã đổi? cập nhật cả chú thích đầu khối CSS và TU_NHIEN").toEqual([1700, 1480, 1420, 1366]);
    expect(thanh(dayDu) - TU_NHIEN.dayDu, `mức ĐẦY ĐỦ từ ${dayDu}px: thanh ${thanh(dayDu)}px so với ${TU_NHIEN.dayDu}px tự nhiên — phải dư ≥ 40px (nhãn dài thêm ~20px)`).toBeGreaterThanOrEqual(40);
    expect(thanh(nen) - TU_NHIEN.nen, `mức NÉN từ ${nen}px: thanh ${thanh(nen)}px so với ${TU_NHIEN.nen}px — phải dư ≥ 30px`).toBeGreaterThanOrEqual(30);
    expect(thanh(bieuTuong) - TU_NHIEN.nenBieuTuong, `mức NÉN + BIỂU TƯỢNG từ ${bieuTuong}px: thanh ${thanh(bieuTuong)}px so với ${TU_NHIEN.nenBieuTuong}px — phải dư ≥ 40px`).toBeGreaterThanOrEqual(40);
    expect(thanh(bieuTuongNhan64) - TU_NHIEN.nhan64, `mức nhãn 64px từ ${bieuTuongNhan64}px: thanh ${thanh(bieuTuongNhan64)}px so với ${TU_NHIEN.nhan64}px — phải dư ≥ 30px`).toBeGreaterThanOrEqual(30);
    // Nấc cuối 1280–1365: không dư mấy — ở 1280 headless dư 14px; Chrome trên Windows có thanh cuộn trang ~10px nên chỉ còn dư ~4px
    // (đo bằng Chromium có thanh cuộn thật: vừa khít, không hiện thanh cuộn phụ). Thêm nút vào nhóm thêm là phải đo lại nấc này.
    expect(thanh(1280) - 10 - TU_NHIEN.nenHep, `nấc 1280–1365: thanh ${thanh(1280) - 10}px (trừ thanh cuộn Windows) so với ${TU_NHIEN.nenHep}px`).toBeGreaterThanOrEqual(0);
  });

  it("nhãn 'Khách chốt cả báo giá' / 'Khách không chốt' KHÔNG bị rút gọn bằng CSS (chúng phải nói rõ phạm vi — xem QuoteEditor.tsx)", () => {
    const tsx = doc("./pages/QuoteEditor.tsx");
    expect(tsx).toContain("✓ Khách chốt cả báo giá");
    expect(tsx).toContain("✗ Khách không chốt");
    const cat = RULES.filter((r) => r.chon.some((c) => /btn-success|btn-danger/.test(c)) && /(font-size:\s*0|text-indent|width:\s*\d+px)/.test(r.khai) && r.chon.some((c) => /\.editor \.actions/.test(c)));
    expect(cat.map((r) => r.chon.join(","))).toEqual([]);
  });
});

describe("hợp đồng DOM mà CSS và ui-smoke dựa vào", () => {
  const tsx = doc("./pages/QuoteEditor.tsx");
  it("Lưu, Khách chốt, Khách không chốt, ⋯ là CON TRỰC TIẾP của .actions (không bọc thẻ nào): luật `.actions > .btn` và ui-smoke `.actions > .btn-primary` dựa vào đó", () => {
    const khoi = /<div className="actions"[^>]*>([\s\S]*?)\r?\n {8}<\/div>\r?\n {6}<\/div>/.exec(tsx);
    expect(khoi, "không tìm thấy khối .actions trong QuoteEditor.tsx").not.toBeNull();
    const ruot = khoi![1];
    // Thẻ bọc duy nhất được phép: ô dock (GridTable portal nhóm thêm vào đó) và .kebab-wrap (chứa nút ⋯). Thêm một <div> / <span> bọc
    // nhóm hành động là làm `.actions > .btn-primary` (ui-smoke U9/U10b/U12) và `.actions > .btn` (CSS) hết khớp.
    expect([...ruot.matchAll(/<div className="([^"]+)"/g)].map((m) => m[1])).toEqual(["dock-slot", "kebab-wrap"]);
    expect([...ruot.matchAll(/<span className="([^"]+)"/g)].map((m) => m[1])).toEqual(["dock-nhan", "dock-nhan-dan"]);
    for (const nut of ['className="btn btn-primary"', 'className="btn btn-success"', 'className="btn btn-danger"', 'className="btn kebab-btn"']) expect(ruot, `thiếu nút ${nut}`).toContain(nut);
    // Tab vào nút khuất MỘT PHẦN trong khung cuộn (nhóm thêm / dải điện thoại) → tự cuộn vào tầm nhìn. Phải là listener `focusin` GỐC
    // gắn qua ref: nhóm thêm là PORTAL của GridTable — onFocus của React đi theo cây component, không qua .actions (đã kiểm).
    expect(tsx).toMatch(/<div className="actions" ref=\{ganThanhDay\}>/);
    const ham = tsx.slice(tsx.indexOf("const ganThanhDay"), tsx.indexOf("thanh.removeEventListener(\"focusin\"", tsx.indexOf("const ganThanhDay")) + 60);
    expect(ham).toMatch(/addEventListener\("focusin"/);
    expect(ham, "chỉ cuộn NGANG khung cuộn trong thanh").toMatch(/\.scrollLeft [-+]=/);
    // scrollIntoView trên phần tử của thanh STICKY cuộn cả trang tới vị trí tĩnh của thanh: ui-smoke [U13] bấm "⋯" thì trang nhảy
    // xuống cuối, menu trượt rồi đóng (đã xảy ra với bản đầu của chính hàm này).
    expect(ham, "không được cuộn trang").not.toMatch(/scrollIntoView|scrollTo\(|scrollBy\(/);
    expect(ham, "phải gỡ listener khi thanh rời DOM").toMatch(/removeEventListener\("focusin"/);
    // Thứ tự trong DOM = thứ tự khi nhóm hành động đứng bên phải: nhãn, ô dock, Lưu, Khách chốt, Khách không chốt, ⋯.
    const vt = ["dock-nhan", "dock-slot", "btn btn-primary", "btn btn-success", "btn btn-danger", "kebab-wrap"].map((k) => ruot.indexOf(k));
    expect(vt.every((x) => x >= 0), "thiếu phần tử").toBe(true);
    expect([...vt].sort((x, y) => x - y)).toEqual(vt);
  });
});
