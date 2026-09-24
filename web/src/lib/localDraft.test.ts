import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  khoaBanNhap, ghiBanNhap, docBanNhap, xoaBanNhap, donBanNhapQuaHan, xoaMoiBanNhap, bocAnhKhoiBaoGia,
  ghiNhanNguoiDung, chuyenBanNhapCu,
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

  // ── BẢN NHÁP SỐNG SÓT QUA ĐĂNG XUẤT (ultracode audit vòng 2, 2026-09-08) ────────────────────
  // Khoá bản nháp gắn theo SỐ BÁO GIÁ, không theo người dùng, và sống 7 ngày trong localStorage —
  // thứ không bị xoá khi đăng xuất. Máy dùng chung (văn phòng nhỏ): người tiếp theo mở đúng báo giá
  // đó được ĐỀ NGHỊ khôi phục bản nháp của người trước — giá từng hạng mục, thông tin khách, bảng
  // chi phí nội bộ. Nút Đăng xuất (và nhánh session:revoked) nay gọi xoaMoiBanNhap().
  describe("xoaMoiBanNhap", () => {
    it("xoá SẠCH mọi bản nháp, kể cả bản chưa quá hạn", () => {
      ghiBanNhap(khoaBanNhap(7), { ...baoGia(), title: "Bảy" }, null);
      ghiBanNhap(khoaBanNhap("moi"), { ...baoGia(), title: "Mới" }, null);
      expect(docBanNhap(khoaBanNhap(7))).not.toBeNull();

      expect(xoaMoiBanNhap()).toBe(2);
      expect(docBanNhap(khoaBanNhap(7)), "bản nháp của người trước không được sống qua Đăng xuất").toBeNull();
      expect(docBanNhap(khoaBanNhap("moi"))).toBeNull();
    });

    it("KHÔNG đụng khoá localStorage của thứ khác (theme, cờ giao diện…)", () => {
      localStorage.setItem("theme", "dark");
      ghiBanNhap(khoaBanNhap(9), baoGia(), null);
      xoaMoiBanNhap();
      expect(localStorage.getItem("theme"), "chỉ xoá khoá mang tiền tố bản nháp").toBe("dark");
    });

    it("không có gì để xoá → trả 0, không ném", () => {
      expect(xoaMoiBanNhap()).toBe(0);
    });
  });
});

// FE-04: phiên của A hết hạn (không bấm Đăng xuất), B đăng nhập từ màn Login trên CÙNG trình duyệt rồi
// mở đúng báo giá #7 → trước đây được đề nghị khôi phục phần chưa lưu của A và Lưu dưới tên B.
describe("FE-04 — bản nháp gắn theo người dùng", () => {
  it("nháp của user 1 KHÔNG đọc được bằng user 2 (khoá khác nhau)", () => {
    ghiBanNhap(khoaBanNhap(7, 1), { ...baoGia(), title: "Của A" }, null, 1);
    expect(khoaBanNhap(7, 1)).not.toBe(khoaBanNhap(7, 2));
    expect(docBanNhap(khoaBanNhap(7, 2), 2)).toBeNull();
    expect((docBanNhap(khoaBanNhap(7, 1), 1)!.quote as { title: string }).title).toBe("Của A");
  });

  it("bản nháp mang userId người khác thì không trả ra dù khoá trùng", () => {
    ghiBanNhap(khoaBanNhap(7, 1), baoGia(), null, 1);
    expect(docBanNhap(khoaBanNhap(7, 1), 2)).toBeNull();
  });

  it("đăng nhập người KHÁC người dùng lần trước → xoá sạch nháp (kể cả khoá kiểu cũ); cùng người → giữ", () => {
    expect(ghiNhanNguoiDung(1)).toBe(false);                  // lần đầu: chưa biết ai trước → giữ
    ghiBanNhap(khoaBanNhap(7, 1), baoGia(), null, 1);
    ghiBanNhap(khoaBanNhap(8), baoGia(), null);                 // khoá kiểu cũ
    expect(ghiNhanNguoiDung(1)).toBe(false);
    expect(docBanNhap(khoaBanNhap(7, 1), 1)).not.toBeNull();
    expect(ghiNhanNguoiDung(2)).toBe(true);
    expect(docBanNhap(khoaBanNhap(7, 1))).toBeNull();
    expect(docBanNhap(khoaBanNhap(8))).toBeNull();
  });

  it("chuyenBanNhapCu: bản nháp khoá cũ chuyển sang khoá của người dùng, khoá cũ bị xoá", () => {
    ghiBanNhap(khoaBanNhap(7), { ...baoGia(), title: "Cũ" }, "2026-08-27T00:00:00.000Z");
    chuyenBanNhapCu(7, 5);
    expect(docBanNhap(khoaBanNhap(7))).toBeNull();
    const d = docBanNhap(khoaBanNhap(7, 5), 5)!;
    expect((d.quote as { title: string }).title).toBe("Cũ");
    expect(d.baseUpdatedAt).toBe("2026-08-27T00:00:00.000Z");
  });
});

// app#16 (soát chéo): lần xác lập danh tính ĐẦU TIÊN trên trình duyệt (`quanly:lastUser` còn null) mà là
// một lượt ĐĂNG NHẬP MỚI từ màn Login → không biết bản nháp khoá cũ (trước FE-04) là của ai, nên phải
// xoá; chỉ đường khởi động có phiên sẵn (cùng cookie phiên) mới được chuyển nó sang khoá người dùng.
describe("app#16 — khoá cũ ở lần đăng nhập đầu sau deploy", () => {
  it("đăng nhập MỚI khi chưa có lastUser → nháp khoá cũ của người trước KHÔNG lọt sang người này", () => {
    ghiBanNhap(khoaBanNhap(7), { ...baoGia(), title: "Của A" }, "2026-08-27T00:00:00.000Z");
    ghiBanNhap(khoaBanNhap("moi"), { ...baoGia(), title: "Mới của A" }, null);
    ghiNhanNguoiDung(2, { dangNhapMoi: true });
    chuyenBanNhapCu(7, 2);
    chuyenBanNhapCu("moi", 2);
    expect(docBanNhap(khoaBanNhap(7, 2), 2)).toBeNull();
    expect(docBanNhap(khoaBanNhap("moi", 2), 2)).toBeNull();
    expect(docBanNhap(khoaBanNhap(7))).toBeNull();
  });

  it("đăng nhập MỚI khi chưa có lastUser → KHÔNG đụng khoá mới đã gắn người dùng", () => {
    ghiBanNhap(khoaBanNhap(7, 2), { ...baoGia(), title: "Của 2" }, null, 2);
    ghiNhanNguoiDung(2, { dangNhapMoi: true });
    expect((docBanNhap(khoaBanNhap(7, 2), 2)!.quote as { title: string }).title).toBe("Của 2");
  });

  it("đối chứng: khởi động có phiên sẵn (không dangNhapMoi) → vẫn chuyển được nháp khoá cũ", () => {
    ghiBanNhap(khoaBanNhap(7), { ...baoGia(), title: "Cũ" }, "2026-08-27T00:00:00.000Z");
    ghiNhanNguoiDung(5);
    chuyenBanNhapCu(7, 5);
    expect((docBanNhap(khoaBanNhap(7, 5), 5)!.quote as { title: string }).title).toBe("Cũ");
  });

  it("đối chứng: đã có lastUser là chính người này → đăng nhập mới vẫn giữ và chuyển được nháp khoá cũ", () => {
    ghiNhanNguoiDung(5);
    ghiBanNhap(khoaBanNhap(7), { ...baoGia(), title: "Cũ" }, "2026-08-27T00:00:00.000Z");
    ghiNhanNguoiDung(5, { dangNhapMoi: true });
    chuyenBanNhapCu(7, 5);
    expect((docBanNhap(khoaBanNhap(7, 5), 5)!.quote as { title: string }).title).toBe("Cũ");
  });
});
