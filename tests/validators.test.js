import { describe, it, expect } from "vitest";
import {
  LoginSchema,
  ChangePasswordSchema,
  UserCreateSchema,
  UserUpdateSchema,
  QuoteCreateSchema,
  ListQuerySchema,
  zbool,
} from "../src/validators.js";

describe("zbool (boolean coercion — regression for z.coerce.boolean gotcha)", () => {
  it('parses the STRING "false"/"0"/"no" as false (NOT truthy)', () => {
    expect(zbool.parse("false")).toBe(false);
    expect(zbool.parse("0")).toBe(false);
    expect(zbool.parse("no")).toBe(false);
    expect(zbool.parse("FALSE")).toBe(false);
    expect(zbool.parse(" false ")).toBe(false);
    expect(zbool.parse("")).toBe(false);
  });
  it("parses truthy strings as true", () => {
    expect(zbool.parse("true")).toBe(true);
    expect(zbool.parse("1")).toBe(true);
    expect(zbool.parse("yes")).toBe(true);
  });
  it("passes real booleans through unchanged", () => {
    expect(zbool.parse(true)).toBe(true);
    expect(zbool.parse(false)).toBe(false);
  });
  it('UserCreateSchema honors canSign "false" → false', () => {
    const u = UserCreateSchema.parse({
      username: "tester", password: "GoodPass1", displayName: "T", role: "manager", canSign: "false",
    });
    expect(u.canSign).toBe(false);
  });
});

describe("LoginSchema", () => {
  it("accepts valid input", () => {
    expect(LoginSchema.parse({ username: "alice", password: "secret" })).toBeTruthy();
  });
  it("rejects empty username", () => {
    expect(() => LoginSchema.parse({ username: "", password: "x" })).toThrow();
  });
});

describe("ChangePasswordSchema", () => {
  it("requires 8+ chars with letter + digit", () => {
    expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "short1A" })).toThrow();
    expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "alllowercase" })).toThrow();
    expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "12345678" })).toThrow();
    expect(ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "GoodPass1" })).toBeTruthy();
  });

  // Đo được trên production 2026-09-07 qua Chrome DevTools: tài khoản mời mới (AcceptInviteSchema
  // dùng CHUNG schema `pwd` này) chấp nhận "password1" — có chữ và số, đủ 8 ký tự, nhưng là một
  // trong vài mật khẩu bị thử ĐẦU TIÊN ở mọi cuộc dò tự động. Chốt để không tái diễn.
  it("chặn mật khẩu PHỔ BIẾN dù đủ chữ + số + độ dài (password1, admin123…)", () => {
    for (const yeu of ["password1", "Password1", " PASSWORD1 ", "admin123", "welcome1", "abc12345", "qwerty123"]) {
      expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: yeu }), yeu).toThrow();
    }
  });

  it("vẫn nhận mật khẩu KHÔNG NẰM trong danh sách phổ biến dù cấu trúc tương tự", () => {
    // Không lỡ tay chặn quá tay: mật khẩu lạ, chỉ trùng CẤU TRÚC (chữ+số) với mật khẩu phổ biến,
    // phải qua được — bộ lọc so khớp CHUỖI trong danh sách, không suy luận theo pattern.
    expect(ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "GoodPass1" })).toBeTruthy();
    expect(ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "TruongPhat88" })).toBeTruthy();
  });
});

describe("UserCreateSchema", () => {
  it("validates role enum", () => {
    expect(() => UserCreateSchema.parse({
      username: "u1", password: "GoodPass1", displayName: "U1", role: "owner",
    })).toThrow();
  });
  it("rejects username with special chars", () => {
    expect(() => UserCreateSchema.parse({
      username: "u 1", password: "GoodPass1", displayName: "U1", role: "employee",
    })).toThrow();
  });
});

describe("QuoteCreateSchema", () => {
  it("requires at least 1 sheet", () => {
    expect(() => QuoteCreateSchema.parse({
      title: "T", toCompany: "C", companyId: 1, sheets: [],
    })).toThrow();
  });
  it("coerces numbers from strings", () => {
    const q = QuoteCreateSchema.parse({
      title: "T",
      toCompany: "C",
      companyId: "1",
      vatPercent: "8",
      sheets: [{
        templateId: "1",
        items: [{ name: "x", quantity: "3", unitPrice: "100" }],
      }],
    });
    expect(q.companyId).toBe(1);
    expect(q.vatPercent).toBe(8);
    expect(q.sheets[0].items[0].quantity).toBe(3);
  });
});

describe("ListQuerySchema", () => {
  it("defaults page=1, size=20, sort=createdAt desc", () => {
    const q = ListQuerySchema.parse({});
    expect(q.page).toBe(1);
    expect(q.size).toBe(20);
    expect(q.sort).toBe("createdAt");
    expect(q.order).toBe("desc");
  });
  it("rejects size over MAX_PAGE_SIZE", () => {
    expect(() => ListQuerySchema.parse({ size: 9999 })).toThrow();
  });
});

describe("Mã dự án — phép chuẩn hoá phải BẤT BIẾN", () => {
  /* ── VÌ SAO ───────────────────────────────────────────────────────────────────────────────
     Modal "Sửa tài khoản" NẠP SẴN mã dự án đã lưu rồi gửi lại y nguyên MỖI LẦN Lưu, kể cả khi
     admin chỉ vào đổi số điện thoại. Nên phép chuẩn hoá chạy lại trên chính kết quả của nó, lần
     này qua lần khác. Bản cũ cắt đuôi 2 chữ số ĐÚNG MỘT LẦN nên mã bị BÀO MÒN dần:

         FP_A2026  →  FP_A20  →  FP_A        (mỗi mũi tên là một lần bấm Lưu)

     Hậu quả không dừng ở cái tên: `nextProjectCode` khoá bộ đếm theo cặp (prefix, năm), nên mỗi
     lần đuôi đổi là mở một hàng quoteCounter MỚI — dãy mã dự án của người đó gãy giữa chừng rồi
     đánh số lại từ _001.

     CHÍNH SÁCH "đuôi 2 chữ số luôn là năm gõ nhầm" GIỮ NGUYÊN (nó đã chữa một sự cố thật: cả 5
     nhân viên mang đuôi "26"). Chỗ sửa chỉ là chạy tới ĐIỂM DỪNG thay vì cắt một nhát. */
  const chuan = (v) => UserUpdateSchema.parse({ projectCode: v }).projectCode;

  it("chạy lại lần hai KHÔNG đổi gì nữa", () => {
    for (const goc of ["FP_A2026", "FP_A20", "FP_D26", "NV2024", "FP_A", "FP_A1", "FP_A26_001"]) {
      const lan1 = chuan(goc);
      const lan2 = chuan(lan1 ?? "");
      expect(lan2, `"${goc}" → "${lan1}" → "${lan2}" — còn bào mòn qua mỗi lần Lưu`).toBe(lan1);
    }
  });

  it("vẫn gỡ đúng phần máy tự thêm: dãy _NNN và hai số năm", () => {
    // Vế đối trọng: sửa thành "không cắt gì" thì dán lại một mã đã cấp sẽ đẻ ra FP_A26_001_001.
    expect(chuan("FP_A26_001")).toBe("FP_A");
    expect(chuan("FP_D26")).toBe("FP_D");
  });

  it("đuôi MỘT chữ số không bị coi là năm", () => {
    // Chính sách chỉ nói về HAI chữ số. Cắt tham hơn là đổi luật, không phải sửa lỗi.
    expect(chuan("FP_A1")).toBe("FP_A1");
  });
});
