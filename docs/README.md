# Tài liệu QuanLY

Mọi tài liệu ĐANG HIỆU LỰC nằm trong thư mục này. Tài liệu lịch sử nằm ở
[`archive/`](archive/) và được đánh dấu rõ là lịch sử.

> **Nguồn sự thật là MÃ NGUỒN.** Tài liệu mô tả mã, không thay thế mã. Khi tài
> liệu và mã mâu thuẫn, mã đúng và tài liệu là lỗi cần sửa.

## Bắt đầu từ đâu

| Bạn là ai / cần gì | Đọc theo thứ tự |
|---|---|
| Mới vào dự án | [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) → [development/SETUP.md](development/SETUP.md) → [product/FEATURES.md](product/FEATURES.md) |
| Sắp sửa code | [development/SETUP.md](development/SETUP.md) → [development/TESTING.md](development/TESTING.md) → [../AGENTS.md](../AGENTS.md) |
| Sắp deploy | [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md) |
| Đang có sự cố | [operations/INCIDENT_RESPONSE.md](operations/INCIDENT_RESPONSE.md) |
| Mất dữ liệu / phải khôi phục | [operations/DISASTER_RECOVERY.md](operations/DISASTER_RECOVERY.md) |
| Soát bảo mật | [architecture/SECURITY_MODEL.md](architecture/SECURITY_MODEL.md) → [product/ROLES_PERMISSIONS.md](product/ROLES_PERMISSIONS.md) |

## Bố cục

```
docs/
├── architecture/     hệ thống ghép lại thế nào, và vì sao
│   ├── ARCHITECTURE.md
│   └── SECURITY_MODEL.md
│
├── development/      làm việc trên mã nguồn
│   ├── SETUP.md
│   └── TESTING.md
│
├── operations/       vận hành nó
│   ├── DEPLOYMENT.md
│   ├── MONITORING.md
│   ├── DISASTER_RECOVERY.md
│   ├── INCIDENT_RESPONSE.md
│   └── SLO.md
│
├── product/          nó LÀM gì và ai được làm gì
│   ├── FEATURES.md
│   └── ROLES_PERMISSIONS.md
│
├── adr/              các quyết định kiến trúc, kèm lý do
│
└── archive/          tài liệu LỊCH SỬ — đã có tiêu đề cảnh báo
    ├── audits/
    ├── performance/
    └── handoff/
```

## Tài liệu nào được CI ràng buộc

Không phải tài liệu nào cũng dễ trôi như nhau. Ba thứ dưới đây **không thể trôi**,
vì có bước CI đối chiếu chúng với mã nguồn:

| Tài liệu | Ràng buộc bởi | Trôi thì hậu quả |
|---|---|---|
| [product/ROLES_PERMISSIONS.md](product/ROLES_PERMISSIONS.md) | `scripts/ci/endpoint-inventory.mjs --check` | Endpoint ngoài ma trận là endpoint **chưa ai soát quyền** |
| [../README.md](../README.md) (số liệu) | `scripts/ci/repo-stats.mjs --check` | README từng ghi hai con số model mâu thuẫn nhau và sai tên thư viện TOTP |
| [../.env.example](../.env.example) | `tests/env-example.test.js` | Thiếu biến bắt buộc → production **không khởi động nổi** |

Phần còn lại dựa vào người viết. Nếu bạn đổi hành vi mà tài liệu mô tả, hãy sửa
tài liệu trong **cùng commit** — tài liệu sai còn tệ hơn không có tài liệu.

## Viết tài liệu ở đây

- Tiếng Việt. Thuật ngữ kỹ thuật giữ nguyên tiếng Anh khi đó là tên thật.
- Giải thích **VÌ SAO**, không chỉ **CÁI GÌ**. Cái gì thì đọc code cũng ra; vì sao thì không.
- Trích dẫn đường dẫn file thật để người đọc kiểm lại được.
- Không viết con số nào không đếm được từ mã nguồn.
- Nói thẳng cái chưa làm. Mục "chưa làm" trung thực có ích hơn một tài liệu tô hồng.
