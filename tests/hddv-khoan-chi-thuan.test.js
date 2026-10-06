// KHOẢN CHI của trang Hóa đơn đầu vào — phần THUẦN (không CSDL): luật trong src/khoanChi.ts, reconcileExtraPayments
// mới (cờ cũ ĐÓNG BĂNG), schema thân request, ma trận quyền, và danh sách ba nhóm của src/inputInvoices.ts.
//
// Chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán, không nằm trong kia nữa" — kế toán tích ĐÃ CHI + ảnh,
// ghi Ngày hóa đơn + Ghi chú kế toán ngay trên trang Hóa đơn đầu vào; dữ liệu ở bảng RIÊNG (InputInvoiceEntry).
//
// ĐỎ trên mã cũ: src/khoanChi.ts chưa có; reconcileExtraPayments cũ tôn trọng payload của người có quote:internal:pay;
// chưa có quyền invoice:input:pay; chưa có KhoanChiSchema; hangHoaDonDauVao chưa có nhóm "Cần chú ý".
import { describe, it, expect } from "vitest";
import {
  trangThaiHieuLuc, tapDaChi, hangDaChiBiMat, tachRidTrung, chupHang, apCoKeToan, phuKeToan, hatGiongJson, coDauVetJsonCu,
  laNgayLich, ngayRaChuoi, ngayTuChuoi, khoaKhoanChi, phiaCuaLoai, bangCuaSheets, hangCuaPhia, tenHangDaChi, dtoKhoanChi,
  loiHangDaChi, tienLucChi, chuanHoaRidTrung, hangVetThieuRid, loiVetThieuRid, sapTheoThuTu,
} from "../src/khoanChi.js";
import { reconcileExtraPayments } from "../src/services/quoteService.js";
import { KhoanChiSchema, KhoanChiParams, QuoteUpdateSchema } from "../src/validators.js";
import { PERMISSIONS as P, ROLE_PERMISSIONS, ADMIN_ONLY_PERMISSIONS, PERMISSION_GROUPS, resolveUserPermissions } from "../src/permissions.js";
import { extraTableSum } from "../src/quoteUtils.js";
import { hangHoaDonDauVao, hangKhoanBaoGiaDaXoa, LY_DO_THIEU_RID, LY_DO_TRUNG_RID } from "../src/inputInvoices.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const khoan = (entries) => new Map(entries.map((e) => [khoaKhoanChi(e.side ?? "sheet", e.rid), { side: "sheet", currentProofId: null, paidAt: null, paidById: null, paidByName: null, ...e }]));

// Một báo giá: trang 1 có bảng hcm (P1 đã chi qua KHOẢN, N1 chỉ có ghi chú, L1 đã trả theo JSON cũ chưa có khoản,
// L2 JSON cũ đã trả nhưng kế toán đã BỎ tích ở khoản) + bản CŨ của bảng HN còn nằm trong trang.
const db = () => [{ extraTables: [
  { category: "hcm", name: "Chi phí HCM", items: [
    { kind: "item", rid: "P1", name: "Thuê xe nâng", quantity: 1, unitPrice: 5000, approved: true },
    { kind: "item", rid: "N1", name: "Vé máy bay", quantity: 1, unitPrice: 3000, approved: true },
    { kind: "item", rid: "L1", name: "Hàng cũ đã trả (JSON)", quantity: 2, unitPrice: 100, approved: true, paid: true, paidAt: "2026-09-02T00:00:00Z", paidById: 5, paidProof: "data:image/png;base64,AAA" },
    { kind: "item", rid: "L2", name: "Đã trả rồi kế toán bỏ tích", quantity: 1, unitPrice: 100, approved: true, paid: true, paidAt: "2026-09-03T00:00:00Z", paidById: 5 },
  ] },
  { category: "hanoi", items: [{ kind: "item", rid: "H9", name: "Bản HN cũ trong trang", quantity: 1, unitPrice: 1, paid: true }] },
] }];
const K = khoan([
  { rid: "P1", paid: true, paidAt: "2026-10-05T03:00:00Z", paidById: 7, paidByName: "Kế toán A", currentProofId: 11 },
  { rid: "N1", paid: false, accountingNote: "chờ HĐ" },
  { rid: "L2", paid: false },
]);

describe("trangThaiHieuLuc (KT-3) — khoản thắng, không có khoản thì cờ JSON cũ", () => {
  it("có khoản → khoản thắng, kể cả khi khoản đã BỎ tích còn JSON vẫn paid:true", () => {
    expect(trangThaiHieuLuc({ paid: false, currentProofId: null }, { paid: true, paidProof: "data:x" })).toMatchObject({ paid: false, hasPaidProof: false, nguon: "bang" });
    expect(trangThaiHieuLuc({ paid: true, paidAt: new Date("2026-10-05T03:00:00Z"), paidById: 7, paidByName: "A", currentProofId: 3 }, {}))
      .toEqual({ paid: true, paidAt: "2026-10-05T03:00:00.000Z", paidById: 7, paidByName: "A", hasPaidProof: true, nguon: "bang" });
  });
  it("không có khoản → cờ JSON cũ (đọc cả paidProof thô lẫn cờ hasPaidProof đã cắt ở SQL)", () => {
    expect(trangThaiHieuLuc(undefined, { paid: true, paidAt: "2026-09-02T00:00:00Z", paidById: 5, paidProof: "data:image/png;base64,A" }))
      .toEqual({ paid: true, paidAt: "2026-09-02T00:00:00.000Z", paidById: 5, paidByName: null, hasPaidProof: true, nguon: "json-cu" });
    expect(trangThaiHieuLuc(undefined, { hasPaidProof: true }).hasPaidProof).toBe(true);
    expect(trangThaiHieuLuc(undefined, {})).toMatchObject({ paid: false, nguon: "khong" });
    expect(trangThaiHieuLuc(undefined, { paid: "true" }).paid, "chuỗi 'true' không phải cờ").toBe(false);
  });
});

describe("tapDaChi + hangDaChiBiMat (KT-4) — so TẬP rid của CẢ PHÍA", () => {
  const daChi = tapDaChi("sheet", bangCuaSheets(db()), K);
  it("tập đã chi hiệu lực = P1 (khoản) + L1 (JSON cũ); L2 đã bỏ tích, N1 chỉ có ghi chú, H9 là bản HN cũ → không", () => {
    expect([...daChi].sort()).toEqual(["L1", "P1"]);
  });
  it("'Chuyển loại' hcm → khach (giữ rid) KHÔNG bị chặn", () => {
    const sau = clone(db()); sau[0].extraTables[0].category = "khach";
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), bangCuaSheets(sau), daChi)).toEqual([]);
  });
  it("chuyển hàng sang TRANG khác (giữ rid) không bị chặn", () => {
    const sau = [{ extraTables: [{ category: "hcm", items: [] }] }, { extraTables: [clone(db())[0].extraTables[0]] }];
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), bangCuaSheets(sau), daChi)).toEqual([]);
  });
  it("xoá hàng đã chi (khoản) → chặn, nêu tên", () => {
    const sau = clone(db()); sau[0].extraTables[0].items = sau[0].extraTables[0].items.filter((i) => i.rid !== "P1");
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), bangCuaSheets(sau), daChi)).toEqual(["Thuê xe nâng"]);
  });
  it("xoá hàng JSON cũ đã trả (chưa có khoản) → chặn", () => {
    const sau = clone(db()); sau[0].extraTables[0].items = sau[0].extraTables[0].items.filter((i) => i.rid !== "L1");
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), bangCuaSheets(sau), daChi)).toEqual(["Hàng cũ đã trả (JSON)"]);
  });
  it("xoá cả bảng / cả trang / client cũ gửi extraTables [] → chặn cả hai hàng", () => {
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), [], daChi).sort()).toEqual(["Hàng cũ đã trả (JSON)", "Thuê xe nâng"]);
  });
  it("xoá hàng chỉ có ghi chú (N1) hoặc hàng JSON cũ đã BỎ tích (L2) → cho", () => {
    const sau = clone(db()); sau[0].extraTables[0].items = sau[0].extraTables[0].items.filter((i) => i.rid !== "N1" && i.rid !== "L2");
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), bangCuaSheets(sau), daChi)).toEqual([]);
  });
  it("bỏ bản 'hanoi' cũ trong trang (đường Lưu đầy đủ vốn lọc nó) → không chặn", () => {
    const sau = clone(db()); sau[0].extraTables = sau[0].extraTables.filter((t) => t.category !== "hanoi");
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), bangCuaSheets(sau), daChi)).toEqual([]);
  });
  it("tập rỗng thì không bao giờ chặn (đường nhanh)", () => {
    expect(hangDaChiBiMat("sheet", bangCuaSheets(db()), [], new Set())).toEqual([]);
  });
  it("loiHangDaChi: 400 (không 409 — màn soạn giữ phần đang soạn), code 'hang-da-chi', tối đa 5 tên", () => {
    const e = loiHangDaChi(["a", "b", "c", "d", "e", "f"]);
    expect(e.status).toBe(400);
    expect(e.code).toBe("hang-da-chi");
    expect(e.message).toContain("6 khoản");
    expect(e.message).toContain('"e"');
    expect(e.message).not.toContain('"f"');
    expect(e.message).toContain("Hóa đơn đầu vào");
  });
});

describe("tachRidTrung (KT-6)", () => {
  it("hàng thứ hai trở đi cùng rid trong MỘT phía nhận rid mới; hàng đầu giữ; phía khác không đụng", () => {
    const sheets = [{ extraTables: [
      { category: "hcm", items: [{ rid: "a" }, { rid: "b" }, { kind: "section", rid: "a" }] },
      { category: "khach", items: [{ rid: "a" }] },
      { category: "hanoi", items: [{ rid: "a" }] },
    ] }];
    let i = 0;
    const n = tachRidTrung("sheet", bangCuaSheets(sheets), () => `moi-${++i}`);
    expect(n).toBe(1);
    expect(sheets[0].extraTables[0].items.map((x) => x.rid)).toEqual(["a", "b", "a"]);   // dòng nhóm không tính
    expect(sheets[0].extraTables[1].items[0].rid).toBe("moi-1");
    expect(sheets[0].extraTables[2].items[0].rid, "bản HN cũ trong trang không thuộc phía sheet").toBe("a");
  });
});

// Soát 2026-10-06 (ATDL-1/2): rid TRÙNG / dính khoảng trắng có sẵn trong CSDL làm cờ + ảnh dời hàng hoặc rơi im khi Lưu.
describe("chuanHoaRidTrung — ghép từng bản CSDL ↔ payload theo thứ tự hiển thị TRƯỚC reconcile", () => {
  const sinh = () => { let i = 0; return () => `moi-${++i}`; };
  const dbDup = () => [{ category: "hcm", items: [
    { rid: "dup", name: "A" },
    { rid: "dup", name: "B", paid: true, paidProof: "data:image/png;base64,B" },
    { rid: "x", name: "X" },
  ] }];
  const plDup = (...ten) => [{ category: "hcm", items: ten.map((name) => ({ rid: name === "X" ? "x" : "dup", name })) }];

  it("bản ĐẦU giữ rid; bản sau nhận rid mới NGAY TRÊN bản CSDL; payload thứ j nhận đúng rid của bản CSDL thứ j", () => {
    const d = dbDup(), p = plDup("A", "B", "X");
    expect(chuanHoaRidTrung("sheet", d, p, sinh())).toBe(2);
    expect(d[0].items.map((i) => i.rid)).toEqual(["dup", "moi-1", "x"]);
    expect(p[0].items.map((i) => i.rid)).toEqual(["dup", "moi-1", "x"]);
    // reconcile sau đó kế thừa ĐÚNG cờ của chính hàng: B (payload) ↔ B (CSDL) có ảnh.
    const s = [{ extraTables: p }];
    reconcileExtraPayments(s, [{ extraTables: d }], {});
    expect(s[0].extraTables[0].items.map((i) => [i.name, i.paid, i.paidProof])).toEqual([["A", false, null], ["B", true, "data:image/png;base64,B"], ["X", false, null]]);
  });
  it("payload NHIỀU bản hơn CSDL → phần dư là bản sao, rid mới (không kế thừa gì)", () => {
    const d = dbDup(), p = plDup("A", "B", "C");
    chuanHoaRidTrung("sheet", d, p, sinh());
    expect(p[0].items.map((i) => i.rid)).toEqual(["dup", "moi-1", "moi-2"]);
  });
  it("payload ÍT bản hơn (xoá B đã trả) → B giữ rid riêng trong CSDL, hangDaChiBiMat thấy nó biến mất", () => {
    const d = dbDup(), p = plDup("A", "X");
    chuanHoaRidTrung("sheet", d, p, sinh());
    expect(p[0].items[0].rid).toBe("dup");
    const daChi = tapDaChi("sheet", d, new Map());
    expect([...daChi]).toEqual(["moi-1"]);
    expect(hangDaChiBiMat("sheet", d, p, daChi)).toEqual(["B"]);
  });
  it("đối tượng DÙNG CHUNG (bảng account phụ giữ nguyên từ CSDL) đổi rid tại chỗ, không ghép — cờ đi theo chính nó", () => {
    const khach = { category: "khach", items: [{ rid: "dup", name: "Phí KH", paid: true }] };
    const d = [{ category: "hcm", items: [{ rid: "dup", name: "HCM" }] }, khach];
    const p = [{ category: "hcm", items: [{ rid: "dup", name: "HCM (sửa)" }] }, khach];
    expect(chuanHoaRidTrung("sheet", d, p, sinh())).toBe(1);
    expect(p[0].items[0].rid, "hàng HCM của payload vẫn là chủ rid").toBe("dup");
    expect(khach.items[0].rid).toBe("moi-1");
  });
  it("rid CSDL dính khoảng trắng → cắt (prior của reconcile tra rid THÔ); không trùng thì không đụng gì", () => {
    const d = [{ category: "hcm", items: [{ rid: "w1 ", name: "W", paid: true }, { rid: "y", name: "Y" }] }];
    const p = [{ category: "hcm", items: [{ rid: "w1", name: "W" }, { rid: "y", name: "Y" }] }];
    expect(chuanHoaRidTrung("sheet", d, p, sinh())).toBe(1);
    expect(d[0].items.map((i) => i.rid)).toEqual(["w1", "y"]);
    const s = [{ extraTables: p }];
    reconcileExtraPayments(s, [{ extraTables: d }], {});
    expect(s[0].extraTables[0].items[0].paid, "mã cũ: 'w1' ≠ 'w1 ' → cờ rơi im").toBe(true);
    expect(chuanHoaRidTrung("sheet", d, p, sinh()), "chạy lại: 0").toBe(0);
  });
  it("phía 'hn' độc lập phía 'sheet'; dòng không có rid không tính", () => {
    const d = [{ items: [{ rid: "h", name: "1" }, { name: "không mã" }, { rid: "h", name: "2" }] }];
    const p = [{ items: [{ rid: "h", name: "1" }, { name: "không mã" }, { rid: "h", name: "2" }] }];
    expect(chuanHoaRidTrung("hn", d, p, sinh())).toBe(2);
    expect(p[0].items.map((i) => i.rid ?? null)).toEqual(["h", null, "moi-1"]);
  });
  it("sapTheoThuTu: trang theo order rồi id — cùng thứ tự với danh sách và công cụ chuyển dữ liệu; không đụng mảng gốc", () => {
    const goc = [{ id: 9, order: 2 }, { id: 5, order: 1 }, { id: 3, order: 2 }];
    expect(sapTheoThuTu(goc).map((s) => s.id)).toEqual([5, 3, 9]);
    expect(goc.map((s) => s.id)).toEqual([9, 5, 3]);
  });
});

describe("hàng đã trả (cũ) THIẾU rid / bản trùng — chốt xoá báo giá và chốt Lưu", () => {
  it("hangVetThieuRid: chỉ hàng KHÔNG mã mà CÓ dấu vết (đã trả hoặc có ảnh)", () => {
    const t = [{ category: "hcm", items: [
      { name: "Không mã đã trả", paid: true }, { rid: "  ", name: "Mã trắng có ảnh", paidProof: "data:x" },
      { name: "Không mã sạch" }, { rid: "r", name: "Có mã đã trả", paid: true },
    ] }];
    expect(hangVetThieuRid("sheet", t)).toEqual(["Không mã đã trả", "Mã trắng có ảnh"]);
  });
  it("loiVetThieuRid: 400, code 'hang-da-chi-thieu-ma', chỉ đường cho quản trị (--sua-rid)", () => {
    const e = loiVetThieuRid(["X"]);
    expect([e.status, e.code]).toEqual([400, "hang-da-chi-thieu-ma"]);
    expect(e.message).toContain('"X"');
    expect(e.message).toContain("--sua-rid");
  });
  it("tenHangDaChi xét MỌI bản: bản đầu theo khoản (đã bỏ tích), bản SAU + hàng không mã theo JSON cũ (đã trả) → vẫn chặn xoá", () => {
    const t = [{ category: "hcm", items: [
      { rid: "d", name: "Bản đầu", paid: true }, { rid: "d", name: "Bản sau", paid: true }, { name: "Không mã", paid: true },
    ] }];
    expect(tenHangDaChi("sheet", t, khoan([{ rid: "d", paid: false }]))).toEqual(["Bản sau", "Không mã"]);
  });
  it("reconcile: bản đồ prior lấy bản ĐẦU khi CSDL còn rid trùng (mã cũ: bản sau ghi đè)", () => {
    const dbTrung = [{ extraTables: [{ category: "hcm", items: [
      { rid: "p", name: "Đầu", quantity: 1, unitPrice: 1 },
      { rid: "p", name: "Sau", quantity: 1, unitPrice: 1, paid: true, paidAt: "2026-08-01T00:00:00Z", paidById: 7, paidProof: "data:image/png;base64,S" },
    ] }] }];
    const s = [{ extraTables: [{ category: "hcm", items: [{ kind: "item", rid: "p", name: "Đầu", quantity: 1, unitPrice: 1 }] }] }];
    reconcileExtraPayments(s, dbTrung, {});
    expect(s[0].extraTables[0].items[0]).toMatchObject({ paid: false, paidProof: null });
  });
});

describe("chupHang / phuKeToan / hatGiongJson", () => {
  it("chụp hàng: dòng 'sub' tên trống thừa hưởng tên hạng mục; tiền qua ĐÚNG extraTableSum (days theo mẫu)", () => {
    const t = { category: "hcm", name: "Bảng A", items: [{ kind: "item", rid: "c", name: "Backdrop", quantity: 2, unitPrice: 1000 }, { kind: "sub", rid: "s", name: "", quantity: 1.5, unitPrice: 333, days: 2 }] };
    const [, con] = [...hangCuaPhia("sheet", [t])];
    expect(chupHang(con, false, "sheet")).toEqual({ name: "Backdrop", unit: null, quantity: 1.5, unitPrice: 333, days: null, amount: Math.round(1.5 * 333), category: "hcm", tableName: "Bảng A" });
    expect(chupHang(con, true, "sheet").amount).toBe(Math.round(1.5 * 2 * 333));
    expect(chupHang(con, true, "hn").category).toBe("hanoi");
  });
  it("lớp phủ ba hình dạng phản hồi + hàng thô danh sách; không đụng bản 'hanoi' cũ; hàng không có khoản giữ cờ JSON", () => {
    const ent = new Map([...K, ["hn:H1", { side: "hn", rid: "H1", paid: true, paidAt: "2026-10-06T00:00:00Z", paidById: 7, currentProofId: null }]]);
    const full = { sheets: [{ extraTables: clone(db())[0].extraTables }], hnTables: [{ items: [{ kind: "item", rid: "H1", paid: false }] }] };
    phuKeToan(full, ent);
    const its = full.sheets[0].extraTables[0].items;
    expect(its.map((x) => [x.rid, x.paid])).toEqual([["P1", true], ["N1", false], ["L1", true], ["L2", false]]);
    expect(its[0]).toMatchObject({ paidById: 7, hasPaidProof: true, paidAt: "2026-10-05T03:00:00.000Z" });
    expect(its[2].paidProof, "hàng không có khoản: để nguyên").toBe("data:image/png;base64,AAA");
    expect(full.sheets[0].extraTables[1].items[0].paid, "bản HN cũ trong trang không bị phủ").toBe(true);
    expect(full.hnTables[0].items[0]).toMatchObject({ paid: true, hasPaidProof: false });
    const internal = { internalSheets: [{ tables: clone(db())[0].extraTables.filter((t) => t.category !== "hanoi") }], hnTables: [{ items: [{ kind: "item", rid: "H1", paid: false }] }] };
    phuKeToan(internal, ent);
    expect(internal.internalSheets[0].tables[0].items.find((x) => x.rid === "L2").paid).toBe(false);
    expect(internal.hnTables[0].items[0].paid).toBe(true);
    const ahn = { hnTables: [{ items: [{ kind: "item", rid: "H1", paid: false }] }] };
    expect(phuKeToan(ahn, ent).hnTables[0].items[0].paid).toBe(true);
    expect(phuKeToan(null, ent)).toBe(null);
  });
  it("apCoKeToan với Map rỗng không đổi gì (đường nhanh khi báo giá chưa có khoản nào)", () => {
    const t = [{ category: "hcm", items: [{ rid: "x", paid: true }] }];
    apCoKeToan("sheet", t, new Map());
    expect(t[0].items[0].paid).toBe(true);
  });
  it("hạt giống JSON cũ + dấu vết", () => {
    expect(hatGiongJson({ paid: true, paidAt: "2026-09-02T00:00:00Z", paidById: 5, paidProof: "data:x" })).toEqual({ paid: true, paidAt: "2026-09-02T00:00:00.000Z", paidById: 5, hasProof: true });
    expect(hatGiongJson({ paid: false, paidAt: "x", paidById: 5 })).toEqual({ paid: false, paidAt: null, paidById: null, hasProof: false });
    expect(coDauVetJsonCu({ hasPaidProof: true })).toBe(true);
    expect(coDauVetJsonCu({ paid: false })).toBe(false);
  });
  it("tenHangDaChi: hàng hiệu lực đã chi + khoản đã chi MỒ CÔI (tên từ rowSnapshot)", () => {
    const ent = khoan([{ rid: "P1", paid: true }, { rid: "MAT", paid: true, rowSnapshot: { name: "Hàng đã rời báo giá" } }, { rid: "L2", paid: false }]);
    expect(tenHangDaChi("sheet", bangCuaSheets(db()), ent).sort()).toEqual(["Hàng cũ đã trả (JSON)", "Hàng đã rời báo giá", "Thuê xe nâng"]);
  });
  it("phía theo loại bảng", () => {
    expect([phiaCuaLoai("hanoi"), phiaCuaLoai("hcm"), phiaCuaLoai("khach")]).toEqual(["hn", "sheet", "sheet"]);
  });
});

describe("ngày hóa đơn là NGÀY THUẦN", () => {
  it("laNgayLich: chỉ YYYY-MM-DD có thật trong 2000–2100", () => {
    expect(laNgayLich("2026-10-05")).toBe(true);
    expect(laNgayLich("2024-02-29")).toBe(true);
    for (const x of ["2026-02-30", "05/10/2026", "2026-1-5", "1999-12-31", "2101-01-01", "", null, 20261005]) expect(laNgayLich(x), String(x)).toBe(false);
  });
  it("khứ hồi không lệch múi giờ (ghi nửa đêm UTC, đọc toISOString)", () => {
    expect(ngayRaChuoi(ngayTuChuoi("2026-10-05"))).toBe("2026-10-05");
    expect(ngayRaChuoi(null)).toBeNull();
  });
});

describe("reconcileExtraPayments mới — cờ cũ ĐÓNG BĂNG cho MỌI người (KT-2)", () => {
  const dbCo = [{ extraTables: [{ category: "hcm", items: [
    { rid: "p1", name: "Thuê cẩu", quantity: 2, unitPrice: 1_000_000, days: null, paid: true, paidAt: "2026-08-01T00:00:00Z", paidById: 7, paidProof: "data:image/png;base64,UNC" },
    { rid: "p2", name: "Chưa trả", quantity: 1, unitPrice: 50, paid: false },
  ] }] }];
  const gui = (doi = (x) => x) => [{ extraTables: [{ category: "hcm", items: doi([
    { kind: "item", rid: "p1", name: "Thuê cẩu", quantity: 2, unitPrice: 1_000_000, paid: false, paidAt: null, paidById: null },
    { kind: "item", rid: "p2", name: "Chưa trả", quantity: 1, unitPrice: 50, paid: true, paidAt: "2020-01-01", paidById: 99 },
    { kind: "item", name: "Hàng mới", quantity: 1, unitPrice: 9, paid: true, paidAt: "x", paidById: 1 },
  ]) }] }];
  it("payload giả cờ (bỏ tích hàng đã trả, tích hàng chưa trả, tích hàng mới) → JSON theo CSDL, kể cả người được miễn chốt tiền", () => {
    for (const mien of [false, true]) {
      const s = gui();
      reconcileExtraPayments(s, dbCo, { mienChotTien: mien });
      expect(s[0].extraTables[0].items.map((i) => [i.rid ?? "(mới)", i.paid, i.paidAt, i.paidById, i.paidProof])).toEqual([
        ["p1", true, "2026-08-01T00:00:00Z", 7, "data:image/png;base64,UNC"],
        ["p2", false, null, null, null],
        ["(mới)", false, null, null, null],
      ]);
    }
  });
  it("chốt tiền theo TRẠNG THÁI HIỆU LỰC: hàng đã chi qua khoản (JSON chưa có cờ) đổi tiền → 400", () => {
    const s = gui((its) => { its[1].unitPrice = 999; return its; });
    expect(() => reconcileExtraPayments(s, dbCo, { daChi: new Set(["p2"]) })).toThrowError(/đã chi/);
  });
  it("kế toán đã BỎ tích (khoản) thì cờ JSON cũ paid:true không còn khoá số tiền", () => {
    const s = gui((its) => { its[0].unitPrice = 1_500_000; return its; });
    expect(() => reconcileExtraPayments(s, dbCo, { daChi: new Set() })).not.toThrow();
    expect(s[0].extraTables[0].items[0].paid, "cờ JSON vẫn đóng băng").toBe(true);
  });
  it("không truyền daChi → lùi về cờ JSON của CSDL (createQuote / đường cũ)", () => {
    const s = gui((its) => { its[0].quantity = 3; return its; });
    let loi; try { reconcileExtraPayments(s, dbCo); } catch (e) { loi = e; }
    expect(loi?.status).toBe(400);
    expect(loi?.message).toContain("Thuê cẩu");
    expect(loi?.message).toContain("Hóa đơn đầu vào");
  });
  it("người có quyền tích (mienChotTien) đổi được số tiền hàng đã chi; fail-open khi CSDL không ghi số tiền", () => {
    const s = gui((its) => { its[0].unitPrice = 3; return its; });
    expect(() => reconcileExtraPayments(s, dbCo, { daChi: new Set(["p1"]), mienChotTien: true })).not.toThrow();
    const khongSo = [{ extraTables: [{ category: "hcm", items: [{ rid: "p1", paid: true }] }] }];
    expect(() => reconcileExtraPayments(gui(), khongSo, { daChi: new Set(["p1"]) })).not.toThrow();
  });
  it("mỗi rid kế thừa MỘT lần: bản sao rid của hàng đã trả không ăn cờ / ảnh", () => {
    const s = [{ extraTables: [{ category: "hcm", items: [
      { rid: "p1", name: "Thuê cẩu", quantity: 2, unitPrice: 1_000_000 },
      { rid: "p1", name: "Bản bịa", quantity: 1, unitPrice: 50_000_000 },
    ] }] }];
    reconcileExtraPayments(s, dbCo, { daChi: new Set(["p1"]) });
    expect(s[0].extraTables[0].items.map((i) => [i.paid, i.paidProof])).toEqual([[true, "data:image/png;base64,UNC"], [false, null]]);
  });
  it("zod của đường Lưu CẮT paid / paidAt / paidById / paidProof (lớp thứ nhất)", () => {
    const b = QuoteUpdateSchema.parse({ title: "x", sheets: [{ templateId: 1, extraTables: [{ category: "hcm", items: [{ kind: "item", name: "a", paid: true, paidAt: "x", paidById: 3, paidProof: "data:image/png;base64,A" }] }] }] });
    const it0 = b.sheets[0].extraTables[0].items[0];
    for (const k of ["paid", "paidAt", "paidById", "paidProof"]) expect(it0, k).not.toHaveProperty(k);
  });
});

describe("KhoanChiSchema / KhoanChiParams", () => {
  const ok = (b) => KhoanChiSchema.safeParse(b).success;
  it("đúng hình dạng", () => {
    expect(ok({ baseVersion: 0, paid: true })).toBe(true);
    expect(ok({ baseVersion: 3, paidProof: null })).toBe(true);
    expect(ok({ baseVersion: 1, invoiceDate: "2026-10-05", accountingNote: "  chờ HĐ  " })).toBe(true);
    expect(ok({ baseVersion: 1, invoiceDate: "" })).toBe(true);
    expect(ok({ baseVersion: 1, invoiceDate: null, accountingNote: null })).toBe(true);
    expect(ok({ baseVersion: 0, paid: true, paidProof: "data:image/png;base64,iVBORw0KGgo=" })).toBe(true);
  });
  it("từ chối: thân rỗng / chỉ baseVersion, thiếu baseVersion, paid chuỗi, ảnh '' (không phải cách gỡ), bỏ tích kèm ảnh, ngày sai, ghi chú > 1000", () => {
    expect(ok({})).toBe(false);
    expect(ok({ baseVersion: 0 })).toBe(false);
    expect(ok({ paid: true })).toBe(false);
    expect(ok({ baseVersion: -1, paid: true })).toBe(false);
    expect(ok({ baseVersion: 0, paid: "false" })).toBe(false);
    expect(ok({ baseVersion: 0, paidProof: "" })).toBe(false);
    expect(ok({ baseVersion: 0, paid: false, paidProof: "data:image/png;base64,iVBORw0KGgo=" })).toBe(false);
    expect(ok({ baseVersion: 0, paidProof: 'data:image/png;base64,AAA" onerror="x' })).toBe(false);
    expect(ok({ baseVersion: 0, invoiceDate: "2026-02-30" })).toBe(false);
    expect(ok({ baseVersion: 0, invoiceDate: "05/10/2026" })).toBe(false);
    expect(ok({ baseVersion: 0, accountingNote: "x".repeat(1001) })).toBe(false);
  });
  it("ghi chú TRIM trước khi đo độ dài", () => {
    const r = KhoanChiSchema.parse({ baseVersion: 0, accountingNote: `  ${"x".repeat(1000)}  ` });
    expect(r.accountingNote).toHaveLength(1000);
  });
  it("params: phía chỉ 'sheet' | 'hn'; rid 1..64", () => {
    expect(KhoanChiParams.safeParse({ quoteId: "5", side: "sheet", rid: "abc" }).success).toBe(true);
    expect(KhoanChiParams.safeParse({ quoteId: "5", side: "hcm", rid: "abc" }).success).toBe(false);
    expect(KhoanChiParams.safeParse({ quoteId: "5", side: "hn", rid: "x".repeat(65) }).success).toBe(false);
    expect(KhoanChiParams.safeParse({ quoteId: "0", side: "hn", rid: "a" }).success).toBe(false);
  });
});

describe("quyền invoice:input:pay — Kế toán + Admin; quote:internal:pay nghỉ hưu", () => {
  it("vai mặc định", () => {
    expect(P.INVOICE_INPUT_PAY).toBe("invoice:input:pay");
    expect(ROLE_PERMISSIONS.accountant.has(P.INVOICE_INPUT_PAY)).toBe(true);
    expect(ROLE_PERMISSIONS.admin.has(P.INVOICE_INPUT_PAY)).toBe(true);
    for (const r of ["manager", "hr", "account_hn"]) expect(ROLE_PERMISSIONS[r].has(P.INVOICE_INPUT_PAY), r).toBe(false);
    expect(ADMIN_ONLY_PERMISSIONS.has(P.INVOICE_INPUT_PAY), "cấp động được cho vai khác").toBe(false);
  });
  it("tài khoản chi phí (quyền riêng gồm quote:internal:pay) KHÔNG có quyền mới; admin cũng thôi giữ khoá cũ", () => {
    const chiPhi = resolveUserPermissions("hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY]);
    expect(chiPhi).not.toContain(P.INVOICE_INPUT_PAY);
    expect(ROLE_PERMISSIONS.admin.has(P.QUOTE_INTERNAL_PAY)).toBe(false);
  });
  it("ma trận: ô mới ở nhóm Hóa đơn; ô cũ rời ma trận nhưng hằng số còn", () => {
    const hien = new Set(PERMISSION_GROUPS.flatMap((g) => g.perms));
    expect(PERMISSION_GROUPS.find((g) => g.key === "invoice").perms).toContain(P.INVOICE_INPUT_PAY);
    expect(hien.has("quote:internal:pay")).toBe(false);
    expect(Object.values(P)).toContain("quote:internal:pay");
  });
});

describe("chốt chặn: tiền không phụ thuộc dữ liệu kế toán", () => {
  it("extraTableSum giống hệt khi có / không có cờ kế toán và lớp phủ", () => {
    const t = clone(db())[0].extraTables[0];
    const a = extraTableSum(t);
    const t2 = clone(t); phuKeToan({ sheets: [{ extraTables: [t2] }] }, K);
    for (const it of t2.items) Object.assign(it, { accountingNote: "x", invoiceDate: "2026-10-05" });
    expect(extraTableSum(t2)).toBe(a);
  });
});

describe("dtoKhoanChi — phần kế toán của một dòng, KHÔNG bao giờ có ảnh", () => {
  it("có khoản: mốc phiên bản, ảnh (siêu dữ liệu, mới nhất trước, đánh dấu ảnh hiện tại), tiền lúc chi, 'số tiền đã đổi'", () => {
    const e = { id: 9, quoteId: 5, side: "sheet", rid: "P1", paid: true, paidAt: new Date("2026-10-05T03:00:00Z"), paidById: 7, paidByName: "KT", paidSnapshot: { amount: 5000 }, currentProofId: 12, invoiceDate: new Date("2026-10-04T00:00:00Z"), accountingNote: "ok", rowSnapshot: {}, legacySeed: null, source: "trang", version: 3, updatedAt: new Date("2026-10-05T04:00:00Z"), updatedByName: "KT" };
    const anh = [{ id: 11, entryId: 9, uploadedAt: new Date("2026-10-05T03:00:00Z"), uploadedByName: "KT", retiredAt: new Date("2026-10-05T03:30:00Z"), retiredReason: "thay", source: "upload" }, { id: 12, entryId: 9, uploadedAt: new Date("2026-10-05T03:30:00Z"), uploadedByName: "KT", retiredAt: null, retiredReason: null, source: "upload" }];
    const d = dtoKhoanChi({ quoteId: 5, side: "sheet", rid: "P1", entry: e, anh, tienHienTai: 7000 });
    expect(d).toMatchObject({ key: "5:sheet:P1", version: 3, paid: true, paidByName: "KT", hasPaidProof: true, paidAmount: 5000, tienDoi: true, invoiceDate: "2026-10-04", accountingNote: "ok", nguon: "bang", keToanCapNhatBoi: "KT" });
    expect(d.proofs.map((p) => [p.id, p.hienTai, p.retiredReason])).toEqual([[12, true, null], [11, false, "thay"]]);
    expect(JSON.stringify(d)).not.toContain("data:image");
    expect(dtoKhoanChi({ quoteId: 5, side: "sheet", rid: "P1", entry: e, anh, tienHienTai: 5000 }).tienDoi).toBe(false);
    expect(tienLucChi({ paid: false, paidSnapshot: { amount: 1 } })).toBeNull();
  });
  it("chưa có khoản: version 0, trạng thái từ cờ JSON cũ, tên người trả tra từ tenNguoi", () => {
    const d = dtoKhoanChi({ quoteId: 5, side: "hn", rid: "H1", itJson: { paid: true, paidById: 5, hasPaidProof: true }, tenNguoi: new Map([[5, "Kế toán cũ"]]) });
    expect(d).toMatchObject({ key: "5:hn:H1", version: 0, paid: true, paidByName: "Kế toán cũ", hasPaidProof: true, nguon: "json-cu", paidAmount: null, tienDoi: false, invoiceDate: null, proofs: [] });
  });
});

// ═════════ Danh sách Hóa đơn đầu vào: HỢP ba nhóm (src/inputInvoices.ts) ═════════
const DS_MAU = [{ id: 1, companyId: 7, hasDays: false }];
const bg = { id: 5, companyId: 7, projectCode: "FP_A26_005", projectVersion: 1, quoteNumber: "GN26005", title: "Sự kiện", shortTitle: null, status: "converted", hnStatus: null, hnReviewedAt: null, hnReviewerId: null, customer: { code: "KH1", name: "Khách 1" }, company: { shortName: "GN", name: "Gia Nguyễn" }, createdBy: { displayName: "Lan" } };
const hang = (over = {}) => ({ kind: "item", rid: "r1", name: "Thuê xe", quantity: 2, unitPrice: 500000, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: 9, ...over });
const dung = (over = {}) => hangHoaDonDauVao({
  quote: bg, sheets: [{ id: 50, order: 1, name: "Trang A", codeNo: 1 }, { id: 51, order: 2, name: "Trang B", codeNo: 2 }],
  sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", name: "Chi phí HCM", items: [hang()] }] }], bangHn: [], dsMau: DS_MAU,
  tenNguoi: new Map([[9, "Admin"]]), ...over,
});
const eNap = (over) => ({ id: 1, quoteId: 5, side: "sheet", rid: "r1", paid: false, paidAt: null, paidById: null, paidByName: null, paidSnapshot: null, currentProofId: null, invoiceDate: null, accountingNote: null, rowSnapshot: {}, legacySeed: null, source: "trang", version: 1, updatedAt: null, updatedByName: null, ...over });

describe("hangHoaDonDauVao — ba nhóm, khoá ổn định, không ảnh", () => {
  it("hàng bình thường: khoá `quoteId:side:rid`, phía, ghi được, phần kế toán từ khoản", () => {
    const khoanMap = new Map([["sheet:r1", eNap({ invoiceDate: new Date("2026-10-01T00:00:00Z"), accountingNote: "HĐ số 12", version: 4 })]]);
    const [r] = dung({ khoan: khoanMap });
    expect(r).toMatchObject({ key: "5:sheet:r1", side: "sheet", trangThaiHang: "binh-thuong", coTheGhi: true, lyDoKhoa: null, version: 4, invoiceDate: "2026-10-01", accountingNote: "HĐ số 12", nguon: "bang" });
  });
  it("hàng CHƯA DUYỆT mà đã có dữ liệu kế toán → 'chua-duyet' (không biến khỏi trang); chưa duyệt không dữ liệu → không có", () => {
    const tables = [{ category: "hcm", items: [hang({ rid: "bo", approved: false }), hang({ rid: "cu", approved: false, paid: true }), hang({ rid: "trong", approved: false })] }];
    const ds = dung({ sheetTables: [{ sheetId: 50, tables }], khoan: new Map([["sheet:bo", eNap({ rid: "bo", accountingNote: "x" })]]) });
    expect(ds.map((r) => [r.rid, r.trangThaiHang])).toEqual([["bo", "chua-duyet"], ["cu", "chua-duyet"]]);
    expect(ds.find((r) => r.rid === "cu")).toMatchObject({ paid: true, nguon: "json-cu" });
  });
  it("HN chưa duyệt mà có dữ liệu → 'hn-chua-duyet'", () => {
    const ds = dung({ sheetTables: [], quote: { ...bg, hnStatus: "submitted" }, bangHn: [{ items: [hang({ rid: "h1" }), hang({ rid: "h2" })] }], khoan: new Map([["hn:h1", eNap({ side: "hn", rid: "h1", paid: true })]]) });
    expect(ds.map((r) => [r.rid, r.side, r.trangThaiHang, r.paid])).toEqual([["h1", "hn", "hn-chua-duyet", true]]);
  });
  it("khoản mà hàng KHÔNG CÒN trong báo giá → 'khong-con-hang' dựng từ ảnh chụp; vẫn ghi được (bỏ tích / ghi chú)", () => {
    const e = eNap({ id: 7, rid: "mat", paid: true, rowSnapshot: { name: "Hàng đã xoá", quantity: 1, unitPrice: 200, amount: 200, category: "khach", tableName: "Phí KH" } });
    const ds = dung({ khoan: new Map([["sheet:mat", e]]) });
    const r = ds.find((x) => x.rid === "mat");
    expect(r).toMatchObject({ key: "5:sheet:mat", trangThaiHang: "khong-con-hang", name: "Hàng đã xoá", amount: 200, category: "khach", tableName: "Phí KH", coTheGhi: true, paid: true });
  });
  it("rid TRÙNG trên cả phía (khác trang) hoặc thiếu rid → khoá theo vị trí GỒM trang, không ghi được, có lý do", () => {
    const ds = dung({ sheetTables: [
      { sheetId: 50, tables: [{ category: "hcm", items: [hang({ rid: "dup" }), hang({ rid: undefined, name: "Không mã" })] }] },
      { sheetId: 51, tables: [{ category: "hcm", items: [hang({ rid: "dup" })] }] },
    ] });
    expect(ds.map((r) => [r.key, r.coTheGhi, r.lyDoKhoa])).toEqual([
      ["5:hcm:50:0:0", false, LY_DO_TRUNG_RID],
      ["5:hcm:50:0:1", false, LY_DO_THIEU_RID],
      ["5:hcm:51:0:0", false, LY_DO_TRUNG_RID],
    ]);
    expect(new Set(ds.map((r) => r.key)).size, "khoá không trùng giữa hai trang").toBe(3);
  });
  it("báo giá ĐÃ XOÁ: mọi khoản thành dòng 'bao-gia-da-xoa' chỉ xem", () => {
    const ds = hangKhoanBaoGiaDaXoa({ quote: bg, khoan: new Map([["hn:h", eNap({ side: "hn", rid: "h", rowSnapshot: { name: "HN", amount: 1 } })]]) });
    expect(ds[0]).toMatchObject({ trangThaiHang: "bao-gia-da-xoa", coTheGhi: false, side: "hn", category: "hanoi" });
  });
  it("không bao giờ mang ảnh, kể cả khi hàng JSON còn paidProof và khoản có ảnh", () => {
    const ds = dung({ sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", items: [hang({ paid: true, paidProof: "data:image/png;base64,AAAA" })] }] }], khoan: new Map([["sheet:r1", eNap({ paid: true, currentProofId: 3 })]]), anh: new Map([[1, [{ id: 3, entryId: 1, uploadedAt: new Date(), uploadedByName: "KT", retiredAt: null, retiredReason: null, source: "upload" }]]]) });
    const txt = JSON.stringify(ds);
    expect(txt).not.toContain("data:image");
    expect(txt).not.toMatch(/"paidProof"/);
    expect(ds[0].proofs).toHaveLength(1);
  });
});
