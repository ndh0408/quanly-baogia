# Sơ đồ

Sáu sơ đồ, viết bằng **mermaid** trong khối mã ```` ```mermaid ```` — GitHub tự
render, không cần công cụ nào, và diff của một thay đổi là diff văn bản chứ
không phải một file ảnh nhị phân thay hẳn.

| Sơ đồ | Trả lời câu gì |
|---|---|
| [request-lifecycle.md](request-lifecycle.md) | Một request đi qua những lớp nào, lớp nào chặn được nó |
| [quote-save.md](quote-save.md) | Bấm Lưu thì chuyện gì xảy ra trong transaction |
| [quote-lifecycle.md](quote-lifecycle.md) | Báo giá có những trạng thái nào, ai chuyển được |
| [export-paths.md](export-paths.md) | Hai nhánh xuất file khác nhau ở đâu |
| [realtime-sse.md](realtime-sse.md) | Sự kiện đi từ một request tới tab của người khác bằng cách nào |
| [data-model.md](data-model.md) | Bảng nào nối với bảng nào |

## Quy ước

* **Sơ đồ mô tả mã, không thay mã.** Sửa hành vi thì sửa sơ đồ trong **cùng
  commit** — một sơ đồ sai còn tệ hơn không có sơ đồ, vì nó trông có thẩm quyền.
* Không có cổng CI nào đối chiếu sơ đồ với mã. Đây là chỗ dựa vào người viết —
  xem [danh sách tài liệu CÓ cổng ràng buộc](../../README.md#tài-liệu-nào-được-ci-ràng-buộc).
* Ghi tên file/hàm thật vào nhãn để người đọc grep ra được. **Không ghi số dòng**
  — số dòng trôi mỗi lần ai đó thêm một dòng ở file đích.
* Vẽ đúng thứ mã đang làm, kể cả khi nó xấu. Sơ đồ là bản đồ, không phải bản vẽ
  thiết kế mong muốn.
