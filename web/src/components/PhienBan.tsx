// Dải "Hệ thống vừa được cập nhật — [Tải bản mới]" + dòng phiên bản ở chân menu (chủ repo 2026-09-24).
// Logic nằm ở ../lib/phienBan.ts; ở đây chỉ vẽ và nối nút.
import { useEffect, useState, type MouseEvent } from "react";
import { toast } from "../lib/ui";
import {
  usePhienBan, batDauTheoDoi, kiemTraBanMoi, taiBanMoi, luuRoiBao, anTam, hienLai, dangDo, nhanPhienBan, layTrangThai, type DangDo,
} from "../lib/phienBan";

// Câu nhắc kèm dải khi người dùng đang dở gì đó. "chua-ro" (trang không tự khai an toàn) thì KHÔNG nhắc
// gì thêm — phần lớn lúc đó chẳng có gì dở, nhắc mãi thành nhờn; bấm Tải bản mới mới hỏi lại.
const CAU_DO: Record<Exclude<DangDo, null>, string> = {
  "chua-luu": "Bạn còn thay đổi CHƯA LƯU — bấm Lưu trước, rồi bấm Tải bản mới.",
  "form-mo": "Lưu hoặc đóng form đang mở trước, rồi bấm Tải bản mới.",
  "dang-go": "Lưu phần đang gõ trước, rồi bấm Tải bản mới.",
  "dang-tao-file": "Đang tạo file — đợi tải xong rồi bấm Tải bản mới.",
  "xem-thu": "",
  "chua-ro": "",
};
// Câu hỏi lại khi người dùng bấm Tải bản mới lúc đang dở. NÓI THẬT: không hứa "được giữ" — bản nháp tạm
// có thể không khôi phục được (người khác vừa lưu, báo giá quá lớn, có ảnh), soát vòng 2. Còn thay đổi
// chưa lưu thì KHÔNG có nút "Tải luôn": hộp "Tải lại trang?" của trình duyệt không có trên iPhone/iPad
// (WebKit không chạy beforeunload) — tải luôn ở đó là mất ngay, không một lời hỏi (soát vòng 3).
const CAU_HOI: Record<Exclude<DangDo, null>, [string, string]> = {
  "chua-luu": ["Còn thay đổi chưa lưu.", "Bấm “Lưu rồi tải bản mới”: lưu phần đang soạn xong mới tải, không mất gì. (Muốn bỏ thay đổi thì rời báo giá, chọn “Rời, bỏ thay đổi”, rồi bấm Tải bản mới.)"],
  "form-mo": ["Đang mở một form.", "Tải bản mới bây giờ thì nội dung đang nhập trong form sẽ mất."],
  "dang-go": ["Đang gõ dở.", "Tải bản mới bây giờ thì phần đang gõ sẽ mất."],
  "dang-tao-file": ["Đang tạo file.", "Tải bản mới bây giờ thì lượt tạo file đang chạy bị huỷ — phải bấm tải file lại."],
  "xem-thu": ["Đang xem thử quyền.", "Tải bản mới sẽ THOÁT chế độ xem thử — sau đó mọi thao tác là thật."],
  "chua-ro": ["Trang này có thể còn phần đang nhập chưa lưu.", "Tải bản mới bây giờ thì phần đó sẽ mất — lưu trước nếu cần."],
};
// Bấm chuột vào nút làm ô đang gõ mất con trỏ TRƯỚC khi click chạy → lúc hỏi "đang dở không" thì ô đã
// không còn con trỏ, nhánh "đang gõ" không bao giờ hỏi (soát 2026-09-24). Giữ con trỏ ở lại ô.
const giuConTro = (e: MouseEvent) => e.preventDefault();

/** Dải thông báo trên cùng — gắn MỘT lần ở gốc app (main.tsx), có mặt ở mọi màn kể cả đăng nhập. */
export function ThongBaoBanMoi() {
  const s = usePhienBan();
  const [, nhip] = useState(0);
  const [hoi, setHoi] = useState<DangDo>(null);   // đang hỏi lại vì người dùng còn làm dở
  const [dangLuu, setDangLuu] = useState(false);
  useEffect(() => batDauTheoDoi(), []);
  // Câu nhắc đổi theo việc người dùng đang làm (mở form, gõ dở…) và dải hiện lại khi hết giờ ẩn tạm.
  useEffect(() => {
    if (!s.coBanMoi) return;
    const t = window.setInterval(() => nhip((n) => n + 1), 2000);
    return () => window.clearInterval(t);
  }, [s.coBanMoi]);
  const dd = s.coBanMoi ? dangDo() : null;
  // Câu hỏi đi theo trạng thái THẬT, không giữ nguyên từ lúc bấm (soát vòng 3): được hỏi "đang tạo file"
  // / "form đang mở" rồi mới sửa báo giá → chuyển sang "chưa lưu" (chỉ còn "Lưu rồi tải", không "Tải
  // luôn"); đã "Rời, bỏ thay đổi" → câu "chưa lưu" cũ hết hiệu lực, về dải bình thường.
  useEffect(() => {
    if (!hoi || dangLuu) return;
    if (dd === "chua-luu" && hoi !== "chua-luu") setHoi("chua-luu");
    else if (hoi === "chua-luu" && dd !== "chua-luu") setHoi(null);
  }, [hoi, dd, dangLuu]);

  if (!s.coBanMoi || Date.now() < s.anDenLuc) return null;

  const tai = async () => {
    // Lượt vẽ có thể trễ tới 2 giây: kiểm LẠI ngay lúc bấm — vừa sửa báo giá sau khi được hỏi thì hỏi lại.
    if (dangDo() === "chua-luu") { setHoi("chua-luu"); return; }
    setHoi(null);
    if (await taiBanMoi()) return;
    if (dangDo() === "chua-luu") { setHoi("chua-luu"); return; }   // gõ tiếp trong lúc chờ → không tải
    // Không tải được mà vẫn còn bản mới (máy chủ vừa lùi bản thì dải tự biến mất, khỏi báo).
    if (layTrangThai().coBanMoi) toast("Chưa tải được bản mới — mạng chập chờn, máy chủ đang cập nhật hoặc đang lưu dở. Thử lại sau ít phút.", "error");
  };
  const bamTai = () => {
    // Trạng thái lúc bấm; không thấy gì thì lấy trạng thái của lượt vẽ gần nhất (≤ 2 giây trước).
    const bayGio = dangDo() ?? dd;
    if (bayGio) { setHoi(bayGio); return; }
    void tai();
  };
  const luuRoiTai = async () => {
    // Không còn gì để lưu (vd vừa "Rời, bỏ thay đổi"): đừng báo "Chưa lưu được" giả — đi tiếp như bấm
    // Tải bản mới (còn dở gì khác thì hỏi đúng câu đó).
    const bayGio = dangDo();
    if (bayGio !== "chua-luu") { if (bayGio) setHoi(bayGio); else void tai(); return; }
    setDangLuu(true);
    const daLuu = await luuRoiBao().finally(() => setDangLuu(false));
    if (daLuu) { void tai(); return; }
    toast("Chưa lưu được — xem thông báo lỗi trên màn hình, sửa rồi bấm Tải bản mới lại", "error");
    setHoi(null);
  };

  return (
    <div className="thong-bao-ban-moi" role="status" aria-live="polite" data-testid="thong-bao-ban-moi">
      <span className="tbbm-icon" aria-hidden="true">🔄</span>
      <div className="tbbm-chu">
        {hoi ? (
          <span><b>{CAU_HOI[hoi][0]}</b> {CAU_HOI[hoi][1]}</span>
        ) : (
          <span>Hệ thống vừa được cập nhật.{dd && CAU_DO[dd] ? " " + CAU_DO[dd] : ""}</span>
        )}
      </div>
      <div className="tbbm-nut">
        {s.dangTai ? (
          <button type="button" className="btn btn-sm btn-primary" disabled>Đang tải bản mới…</button>
        ) : hoi ? (
          <>
            {hoi === "chua-luu"
              ? <button type="button" className="btn btn-sm btn-primary" disabled={dangLuu} onClick={() => void luuRoiTai()}>{dangLuu ? "Đang lưu…" : "Lưu rồi tải bản mới"}</button>
              : <button type="button" className="btn btn-sm btn-danger" onClick={() => void tai()}>Tải luôn</button>}
            <button type="button" className="btn btn-sm" onClick={() => setHoi(null)}>Hủy</button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onMouseDown={giuConTro} onClick={bamTai}>Tải bản mới</button>
        )}
      </div>
      {!hoi && !s.dangTai && (
        <button type="button" className="tbbm-dong" aria-label="Ẩn thông báo bản mới (nhắc lại sau 30 phút)" title="Ẩn — nhắc lại sau 30 phút" onMouseDown={giuConTro} onClick={() => anTam()}>✕</button>
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
