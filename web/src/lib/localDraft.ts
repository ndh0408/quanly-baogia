// ============================================================================
// BẢN NHÁP CỤC BỘ — lưới cuối cùng chống mất phần đang gõ.
//
// ── CÁC LỚP ĐÃ CÓ, VÀ CHỖ CHÚNG KHÔNG VỚI TỚI ──────────────────────────────
// Trình soạn báo giá đã có ba lớp giữ dữ liệu, và cả ba đều CHỈ sống trong bộ nhớ của tab:
//   · `beforeunload` cảnh báo khi F5 / đóng tab lúc còn thay đổi chưa lưu;
//   · `guardLeave` chặn điều hướng trong ứng dụng;
//   · 401 giữa chừng KHÔNG unmount cây mà phủ hộp đăng nhập lại lên trên (web/src/App.tsx).
// Cái không lớp nào với tới: tab sập, trình duyệt bị kill, máy mất điện, hoặc người dùng bấm
// "Rời khỏi trang" trong hộp cảnh báo. Lúc đó toàn bộ phần đang soạn biến mất, và §54 xếp mất dữ
// liệu là hạng nhất — trên cả bảo mật.
//
// ── VÌ SAO KHÔNG PHẢI CHỈ `JSON.stringify` RỒI `setItem` ────────────────────
// Báo giá ở repo này lưu được tới 60 trang × 1000 dòng, và MỖI dòng mang được mảng ảnh base64
// (`QuoteItem.images`). localStorage chỉ có ~5MB CHUNG cho cả origin. Ghi thẳng là:
//   · ném QuotaExceededError giữa lúc người ta đang gõ, hoặc
//   · chiếm sạch hạn ngạch của mọi thứ khác trên cùng origin.
// Nên: cân TRƯỚC khi ghi. Quá trần thì bóc ảnh ra rồi cân lại; vẫn quá thì KHÔNG ghi và nói thật
// là không ghi được — im lặng thất bại ở đây tệ hơn không có tính năng, vì nó tạo cảm giác an toàn
// giả.
//
// ── BÓC ẢNH LÀ MẤT MÁT, VÀ PHẢI NÓI RA ─────────────────────────────────────
// Bản nháp bị bóc ảnh mà khôi phục rồi bấm Lưu là XOÁ ảnh trên máy chủ. Nên cờ `bocAnh` được ghi
// kèm và nơi gọi BẮT BUỘC hiện nó ra trong câu hỏi khôi phục.
//
// ── PHẠM VI ────────────────────────────────────────────────────────────────
// Chỉ là lưới an toàn cho MỘT tab trên MỘT máy. Không đồng bộ, không thay bản lưu trên máy chủ,
// và tự hết hạn sau 7 ngày để không có bản nháp cổ nào bật lên sau nửa năm.
export const TRAN_BYTE = 1_000_000; // ~1MB: đủ cho báo giá vài nghìn dòng không ảnh, còn xa 5MB
export const HAN_MS = 7 * 24 * 60 * 60 * 1000;
const TIEN_TO = "quanly:draft:quote:";

export type BanNhapCuc = {
  luuLuc: number;
  /** `updatedAt` của bản MÁY CHỦ mà bản nháp này dựa vào — khác đi nghĩa là người khác đã sửa. */
  baseUpdatedAt: string | null;
  /** Ảnh base64 đã bị bóc để lọt trần dung lượng. */
  bocAnh: boolean;
  quote: unknown;
};

/** `id` là số báo giá, hoặc "moi" cho bản chưa từng lưu (#/rnew). */
export const khoaBanNhap = (id: string | number) => `${TIEN_TO}${id}`;

/** localStorage NÉM ở chế độ riêng tư của một số trình duyệt — chỉ chạm vào nó qua đây. */
function kho(): Storage | null {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === "function" ? s : null;
  } catch {
    return null;
  }
}

/**
 * Bản sao KHÔNG có ảnh. Chỉ đi tới đúng chỗ chứa ảnh (`sheets[].items[].images` và
 * `sheets[].extraTables[].items[].images`) chứ không quét đệ quy toàn bộ — quét mù sẽ đụng cả
 * `customerLogo`, thứ NHỎ và cần giữ.
 */
export function bocAnhKhoiBaoGia<T>(q: T): T {
  const b = JSON.parse(JSON.stringify(q)) as {
    sheets?: { items?: { images?: unknown }[]; extraTables?: { items?: { images?: unknown }[] }[] }[];
  };
  for (const s of b.sheets || []) {
    for (const it of s.items || []) delete it.images;
    for (const x of s.extraTables || []) for (const it of x.items || []) delete it.images;
  }
  return b as T;
}

export type KetQuaGhi = "da-ghi" | "da-ghi-bo-anh" | "qua-lon" | "khong-ghi-duoc";

export function ghiBanNhap(khoa: string, quote: unknown, baseUpdatedAt: string | null): KetQuaGhi {
  const s = kho();
  if (!s) return "khong-ghi-duoc";
  const dong = (q: unknown, bocAnh: boolean): BanNhapCuc => ({ luuLuc: Date.now(), baseUpdatedAt, bocAnh, quote: q });
  let than: string;
  let bocAnh = false;
  try {
    than = JSON.stringify(dong(quote, false));
    if (than.length > TRAN_BYTE) {
      bocAnh = true;
      than = JSON.stringify(dong(bocAnhKhoiBaoGia(quote), true));
    }
  } catch {
    return "khong-ghi-duoc"; // vòng tham chiếu / BigInt — không có gì cứu được ở đây
  }
  if (than.length > TRAN_BYTE) return "qua-lon";
  try {
    s.setItem(khoa, than);
  } catch {
    // Hạn ngạch đầy vì THỨ KHÁC trên cùng origin. Dọn bản nháp cũ của chính mình rồi thử LẠI MỘT
    // lần — nếu vẫn không được thì thôi, đừng lặp.
    donBanNhapQuaHan(s);
    try {
      s.setItem(khoa, than);
    } catch {
      return "khong-ghi-duoc";
    }
  }
  return bocAnh ? "da-ghi-bo-anh" : "da-ghi";
}

export function docBanNhap(khoa: string): BanNhapCuc | null {
  const s = kho();
  if (!s) return null;
  let than: string | null;
  try {
    than = s.getItem(khoa);
  } catch {
    return null;
  }
  if (!than) return null;
  let d: BanNhapCuc;
  try {
    d = JSON.parse(than) as BanNhapCuc;
  } catch {
    xoaBanNhap(khoa); // rác không đọc được thì đừng để nó nằm mãi
    return null;
  }
  if (!d || typeof d.luuLuc !== "number" || !d.quote) {
    xoaBanNhap(khoa);
    return null;
  }
  if (Date.now() - d.luuLuc > HAN_MS) {
    xoaBanNhap(khoa);
    return null;
  }
  return d;
}

export function xoaBanNhap(khoa: string): void {
  try {
    kho()?.removeItem(khoa);
  } catch {
    /* không làm gì được thì thôi */
  }
}

/** Dọn MỌI bản nháp quá hạn của ứng dụng này (không đụng khoá của thứ khác trên cùng origin). */
export function donBanNhapQuaHan(s: Storage | null = kho()): number {
  if (!s) return 0;
  let n = 0;
  try {
    const khoas: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(TIEN_TO)) khoas.push(k);
    }
    for (const k of khoas) {
      try {
        const d = JSON.parse(s.getItem(k) || "null") as BanNhapCuc | null;
        if (!d || typeof d.luuLuc !== "number" || Date.now() - d.luuLuc > HAN_MS) {
          s.removeItem(k);
          n++;
        }
      } catch {
        s.removeItem(k);
        n++;
      }
    }
  } catch {
    /* bỏ qua */
  }
  return n;
}
