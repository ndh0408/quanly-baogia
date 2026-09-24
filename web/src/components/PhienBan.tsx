// Dải "Hệ thống vừa được cập nhật — [Tải bản mới]" + dòng phiên bản ở chân menu (chủ repo 2026-09-24).
// Logic nằm ở ../lib/phienBan.ts; ở đây chỉ vẽ và nối nút.
import { useEffect, useState } from "react";
import { toast } from "../lib/ui";
import {
  usePhienBan, batDauTheoDoi, kiemTraBanMoi, taiBanMoi, luuRoiBao, anTam, hienLai, dangDo, nhanPhienBan, type DangDo,
} from "../lib/phienBan";

const CAU_DO: Record<Exclude<DangDo, null>, string> = {
  "chua-luu": "Bạn còn thay đổi CHƯA LƯU — bấm Lưu trước, rồi bấm Tải bản mới.",
  "form-mo": "Lưu hoặc đóng form đang mở trước, rồi bấm Tải bản mới.",
  "dang-go": "Rời ô đang gõ (hoặc lưu) trước, rồi bấm Tải bản mới.",
};

/** Dải thông báo trên cùng — gắn MỘT lần ở gốc app (main.tsx), có mặt ở mọi màn kể cả đăng nhập. */
export function ThongBaoBanMoi() {
  const s = usePhienBan();
  const [, nhip] = useState(0);
  const [hoi, setHoi] = useState<DangDo>(null);   // đang hỏi lại vì người dùng còn làm dở
  useEffect(() => batDauTheoDoi(), []);
  // Câu nhắc đổi theo việc người dùng đang làm (mở form, gõ dở…) và dải hiện lại khi hết giờ ẩn tạm.
  useEffect(() => {
    if (!s.coBanMoi) return;
    const t = window.setInterval(() => nhip((n) => n + 1), 2000);
    return () => window.clearInterval(t);
  }, [s.coBanMoi]);

  if (!s.coBanMoi || Date.now() < s.anDenLuc) return null;
  const dd = dangDo();

  const bamTai = () => {
    const bayGio = dangDo();
    if (bayGio) { setHoi(bayGio); return; }
    void taiBanMoi();
  };
  const luuRoiTai = async () => {
    if (await luuRoiBao()) { void taiBanMoi(); return; }
    toast("Chưa lưu được — xem thông báo lỗi trên màn hình, sửa rồi bấm Tải bản mới lại", "error");
    setHoi(null);
  };

  return (
    <div className="thong-bao-ban-moi" role="status" aria-live="polite" data-testid="thong-bao-ban-moi">
      <span className="tbbm-icon" aria-hidden="true">🔄</span>
      <div className="tbbm-chu">
        {hoi ? (
          <span><b>{hoi === "chua-luu" ? "Còn thay đổi chưa lưu." : "Đang có phần chưa xong."}</b>{" "}
            {hoi === "chua-luu" ? "Lưu trước để không mất, hay tải bản mới luôn?" : "Tải bản mới bây giờ thì phần đang mở / đang gõ sẽ mất."}</span>
        ) : (
          <span>Hệ thống vừa được cập nhật.{dd ? " " + CAU_DO[dd] : ""}</span>
        )}
      </div>
      <div className="tbbm-nut">
        {s.dangTai ? (
          <button type="button" className="btn btn-sm btn-primary" disabled>Đang tải bản mới…</button>
        ) : hoi ? (
          <>
            {hoi === "chua-luu" && <button type="button" className="btn btn-sm btn-primary" onClick={() => void luuRoiTai()}>Lưu rồi tải bản mới</button>}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void taiBanMoi()}>
              {hoi === "chua-luu" ? "Tải luôn (bỏ thay đổi)" : "Tải luôn"}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setHoi(null)}>Hủy</button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={bamTai}>Tải bản mới</button>
        )}
      </div>
      {!hoi && !s.dangTai && (
        <button type="button" className="tbbm-dong" aria-label="Ẩn thông báo bản mới (nhắc lại sau 30 phút)" title="Ẩn — nhắc lại sau 30 phút" onClick={() => anTam()}>✕</button>
      )}
    </div>
  );
}

/** Chân menu trái: "Phiên bản … · Cập nhật …" + nút "Kiểm tra bản mới". */
export function PhienBanChanMenu() {
  const s = usePhienBan();
  const [dangKiem, setDangKiem] = useState(false);
  const { dong1, dong2 } = nhanPhienBan(s.coBanMoi ? null : s.mayChu, s.cuaToi);
  const kiem = async () => {
    setDangKiem(true);
    const co = await kiemTraBanMoi();
    setDangKiem(false);
    if (co === null) toast("Chưa hỏi được máy chủ — kiểm tra mạng rồi thử lại", "error");
    else if (co) { hienLai(); toast("Đã có bản mới — bấm “Tải bản mới” ở dải thông báo trên cùng", "info"); }
    else toast("✓ Bạn đang dùng bản mới nhất", "success");
  };
  return (
    <div className="phien-ban-chan-menu" data-testid="phien-ban-chan-menu">
      <div className="pbcm-dong">{s.coBanMoi ? "Bạn đang dùng bản CŨ" : dong1}</div>
      {!s.coBanMoi && dong2 && <div className="pbcm-dong mo">{dong2}</div>}
      <button type="button" className="pbcm-nut" onClick={() => void kiem()} disabled={dangKiem}>
        {dangKiem ? "Đang kiểm tra…" : "⟳ Kiểm tra bản mới"}
      </button>
    </div>
  );
}
