// Cụm B2 — trang QUẢN LÝ DỰ ÁN / HOÁ ĐƠN kéo ảnh chứng từ base64 về rồi vứt.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `listProjects` (src/services/quoteService.ts) chọn `sheets: { select: { … extraTables: true … } }`
// cho tới 2000 báo giá. `extraTables` là cột jsonb chứa cả `paidProof` — ảnh chứng từ thanh toán
// dạng data-URL base64, mỗi ảnh hàng trăm KB. Nhưng nó CHỈ được dùng để cộng ba con số
// (`hcm`/`hanoi`/`khach` qua `extraTableSum`), rồi bị vứt: không byte ảnh nào đi tiếp ra phản hồi.
// Đây đúng là lỗi mà `listQuotes` đã vá bằng cách cắt `paidProof` NGAY TẠI SQL; đường thứ hai này
// thì chưa, và nó nặng hơn — `take: 2000` thay vì một trang danh sách. Ai mở phải nó: admin
// (`user:manage`), người xem QLDA (`invoice:read`) và KẾ TOÁN (`invoice:page`) — biến `seeAll`.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// SỐ BYTE Postgres gửi về cho tiến trình Node, đếm ngay tại socket: vá lần này KHÔNG làm CSDL đọc
// ít đi (muốn cắt `paidProof` thì máy chủ vẫn phải giải TOAST cột đó ra) — nó cắt đúng phần đi QUA
// DÂY và nằm trong heap của Node. Đo bằng block TOAST là đo nhầm chỗ: con số đó không giảm.
// Cách đếm: bọc `net.Socket.prototype.connect` TRƯỚC khi nạp src/db.js để mọi kết nối của pool đều
// gắn thêm một listener "data" chỉ để cộng độ dài. Thêm listener không đổi hành vi luồng (stream
// phát cho mọi listener), và bản gốc được trả lại ở afterAll.
//
// Bài đối chứng đọc thẳng `extraTables` để chứng minh bộ đếm có hoạt động; nếu nó không nhảy thì
// mọi khẳng định sau đều vô nghĩa.
//
// PHẠM VI "own" (không phải admin) là CỐ Ý: `listProjects` không lọc theo bài test nào cả — với
// phạm vi "xem hết" nó quét mọi báo giá đã chốt trong CSDL test, tức số đo sẽ trộn dữ liệu của các
// bộ test khác. Phạm vi own giới hạn đúng dữ liệu bài này tạo ra; đường lấy `extraTables` thì
// CHUNG cho cả hai phạm vi (cùng một truy vấn), nên vá được đo ở đây là vá cho cả kế toán.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { extraTableSum } from "../src/quoteUtils.js";

let byteNhan = 0;
const connectGoc = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  this.on("data", (b) => { byteNhan += b.length; });
  return connectGoc.apply(this, a);
};
// Nạp SAU khi đã bọc socket — nếu không, kết nối đầu tiên của pool sinh ra trước lớp đếm.
const { prisma } = await import("../src/db.js");
const { listProjects } = await import("../src/services/quoteService.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "QuoteSheet" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b2prj${Date.now()}`;
const SO_BAO_GIA = 8;
// ~400KB/ảnh, NGẪU NHIÊN: chuỗi lặp bị nén ở tầng cột lẫn tầng giao thức nên số byte đo được sẽ
// nhỏ hơn thực tế rất nhiều và bài test mất hết sức phân biệt.
const ANH = `data:image/png;base64,${randomBytes(300_000).toString("base64")}`;

const bang = (category, ten, gia) => ({
  category, name: ten, templateId: null, groupSubtotal: false,
  items: [
    { kind: "section", name: "Nhóm", quantity: 0, unitPrice: 0 },
    // approved: true vì `extraTableSum` CHỈ cộng hàng đã duyệt với hai loại "hcm"/"khach"
    // (loại "hanoi" cộng tất cả) — để cả ba con số đều khác 0, tức đều kiểm được.
    { kind: "item", rid: `${ten}-1`, name: "Thuê xe", quantity: 2, unitPrice: gia, days: null, approved: true, approvedAt: new Date().toISOString(), approvedBy: null, paid: true, paidAt: new Date().toISOString(), paidById: null, paidProof: ANH },
  ],
});

describe.runIf(dbAvailable)("Danh sách dự án — không kéo ảnh chứng từ về Node", () => {
  let userId, doiChung = 0;
  const quoteIds = [];

  const reqGia = () => ({ query: {}, session: { userId, role: "manager", permissions: ["quote:read:own"] } });

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "manager", passwordHash: "x" } });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `P${TAG.slice(-5)}` } });
    const tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } });
    for (let i = 1; i <= SO_BAO_GIA; i++) {
      const q = await prisma.quote.create({ data: {
        quoteNumber: `${TAG}-${i}`, title: `${TAG} bg ${i}`, searchText: TAG, toCompany: "Khách",
        companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
        quoteDate: new Date(), createdById: userId, status: "converted", subtotal: 1000, total: 1080,
        sheets: { create: [{ templateId: tpl.id, order: 1, name: "Trang 1", subtotal: 1000,
          extraTables: [bang("hcm", "A", 1000), bang("hanoi", "B", 2000), bang("khach", "C", 3000)] }] },
      } });
      quoteIds.push(q.id);
    }
  });

  afterAll(async () => {
    net.Socket.prototype.connect = connectGoc;
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("bảo hiểm bộ đếm: đọc thẳng extraTables kéo về hàng MB", async () => {
    const truoc = byteNhan;
    const rows = await prisma.quoteSheet.findMany({ where: { quoteId: { in: quoteIds } }, select: { extraTables: true } });
    expect(rows.length).toBe(SO_BAO_GIA);
    doiChung = byteNhan - truoc;
    // 8 sheet × 3 bảng × ảnh 400KB ≈ 9,6 MB.
    expect(doiChung, "đọc 24 ảnh 400KB mà socket không nhận thêm byte nào ⇒ bộ đếm hỏng").toBeGreaterThan(5_000_000);
  }, 90_000);

  it("listProjects KHÔNG kéo ảnh chứng từ, mà ba con số tiền vẫn y nguyên", async () => {
    const truoc = byteNhan;
    const { data } = await listProjects(reqGia());
    const tang = byteNhan - truoc;
    // Bản cũ: xấp xỉ bằng phép đọc đối chứng ở trên (≈9,6 MB cho 8 báo giá; ở production là tới
    // 2000 báo giá). Ngưỡng 5% của đối chứng: phần còn lại chỉ là mấy chục cột vô hướng.
    expect(tang, `listProjects kéo về ${(tang / 1e6).toFixed(1)} MB (đối chứng ${(doiChung / 1e6).toFixed(1)} MB) — vẫn kéo ảnh chứng từ`)
      .toBeLessThan(doiChung * 0.05);

    expect(data.length).toBe(SO_BAO_GIA);
    // ĐỐI CHIẾU với chính phép tính của đường CŨ: đọc `extraTables` thô từ CSDL rồi cộng bằng
    // `extraTableSum` — nếu cách lấy dữ liệu mới làm lệch dù một đồng thì chỗ này đỏ.
    const tho = await prisma.quoteSheet.findMany({ where: { quoteId: { in: quoteIds } }, select: { quoteId: true, extraTables: true } });
    const cong = (ex, cat) => ex.filter((t) => t && t.category === cat).reduce((a, t) => a + extraTableSum(t), 0);
    // Mỗi bảng: 1 hàng tính tiền (dòng "section" không tính) × 2 × đơn giá.
    for (const d of data) {
      expect(d.sheets.length).toBe(1);
      const ex = tho.find((x) => x.quoteId === d.id).extraTables;
      expect(d.sheets[0].hcm).toBe(cong(ex, "hcm"));
      expect(d.sheets[0].hanoi).toBe(cong(ex, "hanoi"));
      expect(d.sheets[0].khach).toBe(cong(ex, "khach"));
      expect(d.sheets[0].hcm).toBe(2000);
      expect(d.sheets[0].hanoi).toBe(4000);
      expect(d.sheets[0].khach).toBe(6000);
      expect(d.sheets[0].subtotal).toBe(1000);
    }
    expect(JSON.stringify(data).includes("data:image")).toBe(false);
  }, 90_000);
});
