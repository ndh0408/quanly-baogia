/**
 * RT-09 — nối lại SSE phải kéo lại dữ liệu.
 *
 * Máy chủ không ghi `id:`/không có Last-Event-ID, nên sự kiện phát trong khoảng đứt (deploy, hết tuổi
 * thọ 30 phút, rớt mạng) mất hẳn. Trước bản vá, listener `open` của Shell chỉ đặt `lan = 0`: người
 * đang nhìn danh sách báo giá không thấy báo giá vừa được tạo trong lúc deploy, badge thông báo đứng
 * yên. Lần `open` ĐẦU là bắt tay bình thường — không được tải thừa.
 */
import { describe, it, expect, vi } from "vitest";
import { taoXuLyMoSse } from "./Shell";

describe("taoXuLyMoSse", () => {
  it("lần mở đầu không làm gì; từ lần NỐI LẠI trở đi làm mới badge + bắn realtime:changed", () => {
    const refreshBadge = vi.fn();
    const batSuKienDoi = vi.fn();
    const khiMo = taoXuLyMoSse({ refreshBadge, batSuKienDoi });
    khiMo();
    expect(refreshBadge).not.toHaveBeenCalled();
    expect(batSuKienDoi).not.toHaveBeenCalled();
    khiMo();
    expect(refreshBadge, "nối lại mà badge không làm mới — thông báo trong lúc đứt bị mất").toHaveBeenCalledTimes(1);
    expect(batSuKienDoi, "nối lại mà trang không tải lại — dữ liệu thay đổi lúc đứt bị mất").toHaveBeenCalledTimes(1);
    khiMo();
    expect(batSuKienDoi).toHaveBeenCalledTimes(2);
  });
});
