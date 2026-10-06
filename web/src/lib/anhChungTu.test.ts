// ẢNH CHỨNG TỪ — nén ở trình duyệt (lib/anhChungTu.ts). Soát 2026-10-06: tệp không đọc / không giải được (HEIC trên máy
// không hỗ trợ, tệp hỏng, đổi đuôi) làm `nenAnh` reject bằng `Event` THÔ của FileReader / <img> — nơi gọi toast `ex.message`
// nên người dùng nhận một câu chung chung (Event không có message) hoặc không gì cả. Chốt: mọi đường hỏng là `Error` có
// câu tiếng Việt. Không cần DOM thật — thay FileReader / Image bằng bản giả bắn đúng sự kiện hỏng.
import { describe, it, expect, afterEach, vi } from "vitest";
import { nenAnh, compressImage, LOI_DOC_ANH } from "./anhChungTu";

class DocHong {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  result: string | null = null;
  readAsDataURL() { setTimeout(() => this.onerror?.({ type: "error" }), 0); }
}
class DocDuoc extends DocHong {
  readAsDataURL() { this.result = "data:image/heic;base64,AAAA"; setTimeout(() => this.onload?.(), 0); }
}
class AnhHong {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_v: string) { setTimeout(() => this.onerror?.({ type: "error" }), 0); }
}

afterEach(() => { vi.unstubAllGlobals(); });
const tep = () => new File(["x"], "anh.heic", { type: "image/heic" });

describe("nenAnh / compressImage: tệp hỏng → Error có câu tiếng Việt, không phải Event thô", () => {
  it("FileReader không đọc được tệp", async () => {
    vi.stubGlobal("FileReader", DocHong);
    const loi = await nenAnh(tep()).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(Error);
    expect((loi as Error).message).toBe(LOI_DOC_ANH);
  });
  it("đọc được nhưng trình duyệt không giải được ảnh (HEIC…) — compressImage chuyển nguyên câu đó lên", async () => {
    vi.stubGlobal("FileReader", DocDuoc);
    vi.stubGlobal("Image", AnhHong);
    await expect(compressImage(tep())).rejects.toThrow(LOI_DOC_ANH);
  });
});
