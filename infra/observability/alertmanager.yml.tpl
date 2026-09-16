# ── ALERTMANAGER: CHỖ CẢNH BÁO ĐI TÌM NGƯỜI (BẢN MẪU) ──────────────────────
#
# ⚠️ ĐÂY LÀ BẢN MẪU, KHÔNG PHẢI CẤU HÌNH CHẠY ĐƯỢC. Đuôi `.tpl` là cố ý.
# Alertmanager KHÔNG nội suy biến môi trường trong cấu hình — ĐÃ ĐO, không phải suy đoán:
#   docker run -e SMTP_HOST=smtp.gmail.com prom/alertmanager:v0.28.1 --config.file=…
#   → GET /api/v2/status trả về đúng chuỗi   smtp_smarthost: ${SMTP_HOST}:${SMTP_PORT}
# Tệ hơn: `amtool check-config` trên chính file đó in "SUCCESS". Nghĩa là trỏ thẳng
# `--config.file` vào file này sẽ cho một Alertmanager KHỞI ĐỘNG BÌNH THƯỜNG, qua được mọi phép
# kiểm cú pháp, và gửi thư tới một máy chủ tên `${SMTP_HOST}` không tồn tại. Im lặng — đúng chế độ
# hỏng mà việc dựng Alertmanager sinh ra để chấm dứt.
# Nên: `alertmanager-entrypoint.sh` thay giá trị vào rồi mới trao cho Alertmanager, và nó DỪNG nếu
# còn sót một `${` nào.
#
# ── VÌ SAO CÓ FILE NÀY ─────────────────────────────────────────────────────
# Trước 2026-09-16, khối `alerting:` trong prometheus.yml bị chú thích và không có Alertmanager.
# 22 quy tắc — kể cả hai quy tắc viết cho đúng hai chế độ hỏng đã TÁI HIỆN ĐƯỢC (cạn pool,
# oom-kill) — chỉ hiện trên giao diện Prometheus. Có người mở mới thấy.
#
# ── ĐƯỜNG GỬI ──────────────────────────────────────────────────────────────
# Email qua CHÍNH SMTP mà ứng dụng đang dùng thật (production: smtp.gmail.com:587, STARTTLS; log
# khởi động ghi `"Gửi email (SMTP)":true`). Không dựng kênh mới: một kênh đã chạy và đã có người
# đọc đáng tin hơn một kênh vừa dựng mà chưa ai thử.

global:
  # Thời gian Alertmanager coi một cảnh báo là đã hết nếu Prometheus ngừng gửi. Phải dài hơn
  # `evaluation_interval` (15s) vài lần, kẻo một lượt trượt sinh ra cặp "đã hết → lại kêu".
  resolve_timeout: 5m
  smtp_smarthost: "${SMTP_HOST}:${SMTP_PORT}"
  smtp_from: "${SMTP_FROM}"
  # HAI DÒNG `smtp_auth_*` DƯỚI ĐÂY BỊ GỠ HẲN khi SMTP_USER rỗng — xem entrypoint.
  # Dev dùng MailHog (`SMTP_HOST=mailhog`, `SMTP_PORT=1025`, `SMTP_USER=` rỗng): MailHog KHÔNG xác
  # thực và KHÔNG có STARTTLS. Để nguyên hai dòng này ở đó là dev không gửi được thư nào, tức phép
  # thử duy nhất chứng minh được đường cảnh báo hoạt động lại là phép thử không chạy được.
  smtp_auth_username: "${SMTP_USER}"
  # MẬT KHẨU KHÔNG ĐI QUA PHÉP THAY CHUỖI. Nó vào bằng đường tệp (docker secret), nên:
  #   · không nằm trong file đã dựng, không lộ qua `docker inspect`
  #   · và không bị phép thay chuỗi làm hỏng nếu chứa ký tự đặc biệt
  smtp_auth_password_file: /run/secrets/smtp_password
  # Gmail cổng 587 dùng STARTTLS. `true` = BẮT BUỘC nâng cấp lên TLS; `false` là gửi mật khẩu qua
  # kết nối thô. Giá trị do entrypoint quyết định và nó BUỘC CHẶT vào việc có xác thực hay không:
  # có mật khẩu để mất thì BẮT BUỘC TLS, không có gì để mất (MailHog) thì thôi. Hai thứ này không
  # được phép chỉnh riêng lẻ — tách chúng ra là mở đường cho một cấu hình gửi mật khẩu trần.
  smtp_require_tls: ${SMTP_REQUIRE_TLS}

route:
  # GOM THEO alertname + instance, KHÔNG gom tất cả làm một: gom quá rộng thì một sự cố đang diễn ra
  # sẽ nuốt mất cảnh báo thứ hai vừa nổ (nhóm đã gửi chỉ được gửi lại sau `group_interval`).
  group_by: ["alertname", "instance"]
  group_wait: 30s      # dồn vài cảnh báo cùng gốc vào MỘT thư thay vì ba
  group_interval: 5m   # có cảnh báo MỚI trong nhóm đã gửi → chờ ngần này rồi gửi bổ sung
  repeat_interval: 4h  # vẫn đang kêu → nhắc lại. Đủ để không quên, không đủ để thành rác.
  receiver: email
  routes:
    # 11/22 quy tắc là `critical` — nhóm "mất dịch vụ hoặc mất dữ liệu". Cho nó nhịp gấp hơn.
    - matchers: ['severity="critical"']
      receiver: email
      group_wait: 10s
      repeat_interval: 1h

receivers:
  - name: email
    email_configs:
      - to: "${ALERT_EMAIL_TO}"
        send_resolved: true
        headers:
          Subject: '[QuanLY {{ .Status | toUpper }}] {{ .CommonLabels.alertname }}{{ with .CommonLabels.instance }} @ {{ . }}{{ end }}'
        # Thư phải trả lời được "tôi phải làm gì bây giờ" NGAY TRONG THÂN, không bắt mở Prometheus:
        # người bị đánh thức lúc 2 giờ sáng thường chỉ có điện thoại trong tay.
        # `with` chứ không phải `if`: 5/22 quy tắc không có `runbook`
        # (QuanlyTiLeLoi5xxCao, QuanlySsePublishThatBai, QuanlyXuatFileBiTuChoi,
        #  QuanlyWorkerXuatCangCung, QuanlyJobNenThatBai) — `if` sẽ in ra một ô rỗng.
        html: |
          <h3>{{ .Status | toUpper }} — {{ .CommonLabels.alertname }}</h3>
          {{ range .Alerts }}
          <hr>
          <p><b>{{ .Annotations.summary }}</b></p>
          <p>{{ .Annotations.description }}</p>
          {{ with .Annotations.runbook }}<p><b>Cách xử lý:</b> <code>{{ . }}</code></p>{{ end }}
          <p><small>
            severity={{ .Labels.severity }}
            {{ with .Labels.instance }}· instance={{ . }}{{ end }}
            {{ with .Labels.job }}· job={{ . }}{{ end }}<br>
            bắt đầu: {{ .StartsAt }}
          </small></p>
          {{ end }}
        text: |
          {{ .Status | toUpper }} — {{ .CommonLabels.alertname }}
          {{ range .Alerts }}
          * {{ .Annotations.summary }}
            {{ .Annotations.description }}
          {{ with .Annotations.runbook }}  Cách xử lý: {{ . }}
          {{ end }}  severity={{ .Labels.severity }} bắt đầu={{ .StartsAt }}
          {{ end }}

inhibit_rules:
  # CSDL chết thì KÉO THEO một loạt cảnh báo khác (tỉ lệ lỗi, độ trễ, pool chờ…). Gửi hết là chôn
  # nguyên nhân gốc dưới năm lá thư hệ quả. Giữ cái gốc, nén phần còn lại CÙNG instance.
  - source_matchers: ['alertname="QuanlyCsdlKhongToiDuoc"']
    target_matchers: ['severity="warning"']
    equal: ["instance"]
  # Tiến trình đang khởi động lại liên tục thì mọi thứ khác trên instance đó đều là hệ quả.
  - source_matchers: ['alertname="QuanlyTienTrinhKhoiDongLaiLienTuc"']
    target_matchers: ['severity="warning"']
    equal: ["instance"]
