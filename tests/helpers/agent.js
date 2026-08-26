// Agent supertest cư xử GIỐNG TRÌNH DUYỆT THẬT về mặt CSRF.
//
// ── VÌ SAO CẦN ──────────────────────────────────────────────────────────────
// csrfGuard (src/app.ts) đòi header X-CSRF-Token cho MỌI thao tác ghi được xác thực bằng phiên
// cookie. Cả hai SPA đều tự lo việc này trong lớp bọc fetch của mình (web/src/lib/api.ts và
// public/js/core/api.js): lấy mã, đính vào, và thử lại một lần nếu máy chủ báo mã thiếu/không hợp lệ.
//
// Test tích hợp lái ứng dụng bằng supertest, tức là ĐI VÒNG qua lớp bọc đó. Nếu để test tự gửi
// request trần thì chúng không còn mô phỏng client thật nữa. Có hai cách xử lý, và cách chọn ở đây
// là cách khó chệch:
//
//   (a) Tắt CSRF khi NODE_ENV=test. Rẻ, nhưng khi ấy KHÔNG bộ test nào còn chạy qua hàng rào CSRF —
//       một lần siết/nới sai sau này sẽ không bị bắt.
//   (b) Cho agent test làm ĐÚNG việc mà lớp bọc của SPA làm. Test vẫn đi qua hàng rào thật, và
//       việc cấp mã cũng được kiểm gián tiếp ở mọi bộ test tích hợp.
//
// Chọn (b). tests/csrf.test.js CỐ Ý dùng `request.agent(app)` TRẦN để tự dựng từng tình huống
// (thiếu mã, mã sai, mã của phiên khác…) — đừng đổi file đó sang helper này.
//
// ── VÌ SAO LẤY MÃ MỚI TRƯỚC MỖI LẦN GHI, KHÔNG NHỚ TẠM ──────────────────────
// Nhớ tạm thì phải xử lý chuyện mã hết giá trị: đăng nhập gọi session.regenerate() nên bí mật cũ
// biến mất, và nhiều bộ test đăng nhập lại giữa chừng. Xử lý bằng "thử lại rồi phát lại request"
// đòi thò tay vào phần nội bộ của supertest (`_data`, header đã dựng) — mảnh và dễ gãy khi nâng
// phiên bản. Thêm một GET trước mỗi lần ghi trong test là cái giá rẻ hơn nhiều so với một lớp
// helper mà chính nó có thể sai. (SPA thật CÓ nhớ tạm + thử lại — chỗ đó mới cần tối ưu số request.)
import request from "supertest";

const GHI = ["post", "put", "patch", "delete"];

/**
 * Bọc một agent supertest sao cho mọi thao tác ghi tự đính mã CSRF của phiên HIỆN TẠI.
 * Không ghi đè header do phía gọi tự đặt — test nào muốn tự điều khiển mã vẫn làm được.
 */
export function agentWithCsrf(app) {
  const a = request.agent(app);

  for (const m of GHI) {
    const goc = a[m].bind(a);
    a[m] = (url, ...rest) => {
      const t = goc(url, ...rest);
      const gocSet = t.set.bind(t);
      let daDatTay = false;
      t.set = (k, v) => {
        if (String(k).toLowerCase() === "x-csrf-token") daDatTay = true;
        return gocSet(k, v);
      };
      const gocThen = t.then.bind(t);
      t.then = (onOk, onErr) =>
        (async () => {
          if (!daDatTay) {
            const r = await a.get("/api/csrf-token");
            if (r.status === 200 && r.body?.token) gocSet("X-CSRF-Token", r.body.token);
          }
          return gocThen();
        })().then(onOk, onErr);
      return t;
    };
  }
  return a;
}
