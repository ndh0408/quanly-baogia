import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  khoaBanNhap, ghiBanNhap, docBanNhap, xoaBanNhap, donBanNhapQuaHan, bocAnhKhoiBaoGia,
  TRAN_BYTE, HAN_MS,
} from "./localDraft";

// web/ chạy test ở môi trường node (không jsdom) → dựng localStorage giả. Giả này CỐ Ý mô phỏng
// được hai thứ khó chịu của bản thật: ném khi hết hạn ngạch, và ném khi trình duyệt cấm truy cập.
class KhoGia implements Storage {
  private m = new Map<string, string>();
  tranTong = Infinity;
  nemKhiGhi = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  setItem(k: string, v: string) {
    if (this.nemKhiGhi) throw new Error("QuotaExceededError");
    const tong = [...this.m.entries()].filter(([kk]) => kk !== k).reduce((a, [, vv]) => a + vv.length, 0) + v.length;
    if (tong > this.tranTong) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
}

let kho: KhoGia;
beforeEach(() => {
  kho = new KhoGia();
  vi.stubGlobal("localStorage", kho);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const anh = (n: number) => "data:image/png;base64," + "A".repeat(n);
const baoGia = (o: { anhByte?: number; dong?: number } = {}) => ({
  id: 7, title: "Báo giá thử", updatedAt: "2026-08-27T00:00:00.000Z", customerLogo: anh(50),
  sheets: [{
    name: "Trang 1",
    items: Array.from({ length: o.dong ?? 2 }, (_, i) => ({
      order: i + 1, name: `Hạng mục ${i}`, quantity: 1, unitPrice: 1000,
      ...(o.anhByte ? { images: [anh(o.anhByte)] } : {}),
    })),
    extraTables: [{ items: [{ order: 1, name: "Nội bộ", ...(o.anhByte ? { images: [anh(o.anhByte)] } : {}) }] }],
  }],
});

describe("localDraft — lưới cuối chống mất phần đang gõ", () => {
  it("ghi rồi đọc lại đúng nội dung + mốc cơ sở", () => {
    const k = khoaBanNhap(7);
    expect(ghiBanNhap(k, baoGia(), "2026-08-27T00:00:00.000Z")).toBe("da-ghi");
    const d = docBanNhap(k)!;
    expect(d.baseUpdatedAt).toBe("2026-08-27T00:00:00.000Z");
    expect(d.bocAnh).toBe(false);
    expect((d.quote as { title: string }).title).toBe("Báo giá thử");
  });

  it("khoá theo TỪNG báo giá — bản nháp của #7 không lẫn sang #8", () => {
    ghiBanNhap(khoaBanNhap(7), { ...baoGia(), title: "Bảy" }, null);
    ghiBanNhap(khoaBanNhap(8), { ...baoGia(), title: "Tám" }, null);
    expect((docBanNhap(khoaBanNhap(7))!.quote as { title: string }).title).toBe("Bảy");
    expect((docBanNhap(khoaBanNhap(8))!.quote as { title: string }).title).toBe("Tám");
    expect(khoaBanNhap("moi")).not.toBe(khoaBanNhap(0));
  });

  it("QUÁ TRẦN vì ảnh → tự bóc ảnh, ghi được, và ĐÁNH DẤU là đã bóc", () => {
    // 3 dòng × ~400KB ảnh = vượt 1MB; bỏ ảnh ra thì còn vài trăm byte.
    const k = khoaBanNhap(7);
    expect(ghiBanNhap(k, baoGia({ anhByte: 400_000, dong: 3 }), null)).toBe("da-ghi-bo-anh");
    const d = docBanNhap(k)!;
    expect(d.bocAnh).toBe(true);
    const q = d.quote as { sheets: { items: { images?: unknown }[]; extraTables: { items: { images?: unknown }[] }[] }[] };
    expect(q.sheets[0].items.every((it) => it.images === undefined)).toBe(true);
    // Bảng nội bộ cũng phải được bóc — bản đầu chỉ bóc lưới chính.
    expect(q.sheets[0].extraTables[0].items.every((it) => it.images === undefined)).toBe(true);
    // …nhưng logo khách (nhỏ, cần giữ) KHÔNG bị đụng.
    expect((d.quote as { customerLogo?: string }).customerLogo).toBeTruthy();
  });

  it("bóc ảnh KHÔNG sửa đối tượng gốc (người dùng vẫn còn ảnh trên màn hình)", () => {
    const q = baoGia({ anhByte: 10 });
    const b = bocAnhKhoiBaoGia(q);
    expect(b.sheets[0].items[0].images).toBeUndefined();
    expect(q.sheets[0].items[0].images).toBeDefined();
  });

  it("bóc ảnh rồi VẪN quá trần → KHÔNG ghi, và nói rõ là quá lớn (không im lặng)", () => {
    const to = { id: 7, sheets: [{ items: [{ name: "x".repeat(TRAN_BYTE + 10) }] }] };
    expect(ghiBanNhap(khoaBanNhap(7), to, null)).toBe("qua-lon");
    expect(docBanNhap(khoaBanNhap(7))).toBeNull();
  });

  it("hạn ngạch đầy vì thứ khác → dọn bản nháp quá hạn rồi thử LẠI MỘT lần", () => {
    const k = khoaBanNhap(7);
    // Một bản nháp CŨ (quá 7 ngày) đang chiếm chỗ.
    kho.setItem(khoaBanNhap(99), JSON.stringify({ luuLuc: Date.now() - HAN_MS - 1, baseUpdatedAt: null, bocAnh: false, quote: { rac: "y".repeat(500) } }));
    kho.tranTong = 900;   // chật: chỉ đủ chỗ cho MỘT trong hai
    expect(ghiBanNhap(k, { id: 7, title: "z".repeat(300) }, null)).toBe("da-ghi");
    expect(docBanNhap(k)).not.toBeNull();
    expect(kho.getItem(khoaBanNhap(99))).toBeNull();   // bản cũ đã bị dọn
  });

  it("localStorage bị cấm hoàn toàn (chế độ riêng tư) → trả 'khong-ghi-duoc', KHÔNG ném", () => {
    kho.nemKhiGhi = true;
    expect(() => ghiBanNhap(khoaBanNhap(7), baoGia(), null)).not.toThrow();
    expect(ghiBanNhap(khoaBanNhap(7), baoGia(), null)).toBe("khong-ghi-duoc");
    vi.stubGlobal("localStorage", undefined);
    expect(ghiBanNhap(khoaBanNhap(7), baoGia(), null)).toBe("khong-ghi-duoc");
    expect(docBanNhap(khoaBanNhap(7))).toBeNull();
    expect(() => xoaBanNhap(khoaBanNhap(7))).not.toThrow();
  });

  it("bản nháp QUÁ HẠN 7 ngày không bao giờ được đề nghị khôi phục, và bị xoá luôn", () => {
    const k = khoaBanNhap(7);
    ghiBanNhap(k, baoGia(), null);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + HAN_MS + 1000);
    expect(docBanNhap(k)).toBeNull();
    expect(kho.getItem(k)).toBeNull();
  });

  it("rác không đọc được / thiếu trường → coi như không có, và dọn đi", () => {
    const k = khoaBanNhap(7);
    kho.setItem(k, "{khong-phai-json");
    expect(docBanNhap(k)).toBeNull();
    expect(kho.getItem(k)).toBeNull();
    kho.setItem(k, JSON.stringify({ luuLuc: "hôm qua", quote: {} }));
    expect(docBanNhap(k)).toBeNull();
  });

  it("donBanNhapQuaHan chỉ đụng khoá của ứng dụng này", () => {
    kho.setItem("theme", "dark");
    kho.setItem(khoaBanNhap(1), JSON.stringify({ luuLuc: Date.now() - HAN_MS - 1, quote: {} }));
    ghiBanNhap(khoaBanNhap(2), baoGia(), null);
    expect(donBanNhapQuaHan()).toBe(1);
    expect(kho.getItem("theme")).toBe("dark");
    expect(docBanNhap(khoaBanNhap(2))).not.toBeNull();
  });

  it("xoaBanNhap sau khi Lưu thành công thì lần mở sau KHÔNG hỏi khôi phục nữa", () => {
    const k = khoaBanNhap(7);
    ghiBanNhap(k, baoGia(), null);
    xoaBanNhap(k);
    expect(docBanNhap(k)).toBeNull();
  });
});
