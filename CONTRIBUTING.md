# Đóng góp vào QuanLY

> Quy ước kỹ thuật đầy đủ nằm ở **[AGENTS.md](AGENTS.md)** — đọc file đó trước.
> File này chỉ nói quy trình.

## Trước khi gõ dòng mã đầu tiên

Đây là dữ liệu thật của một doanh nghiệp thật, đang chạy. Mọi thay đổi phải giả định **có người
đang dùng ngay lúc này**.

1. **Đọc mã trước khi kết luận.** Tài liệu trong `docs/archive/` là LỊCH SỬ — nhiều phát hiện đã
   được sửa. Đừng vá lại thứ đã vá.
2. **Tái hiện lỗi trước khi sửa.** "Có vẻ sai" không đủ: phải chỉ ra được đầu vào nào cho ra kết
   quả sai nào.
3. Xem [TUYỆT ĐỐI không phá](AGENTS.md#tuyệt-đối-không-phá) — lưới báo giá, IME tiếng Việt,
   clipboard, round-trip Excel, mẫu của công ty. Đó là hành vi production người dùng đã dựa vào.

## Dựng môi trường

```bash
npm ci
npm --prefix web ci
cp .env.example .env        # rồi điền
npm run db:migrate
npm run db:seed
npm run dev                 # API   (http://localhost:3000)
npm --prefix web run dev    # SPA
```

Cần Postgres + Redis + kho object tương thích S3 (MinIO là đủ). Chi tiết:
[docs/development/SETUP.md](docs/development/SETUP.md).

## Vòng làm việc

```bash
npm run verify:nhanh   # vòng lặp sửa nhanh (~2 phút)
npm run verify         # TRƯỚC KHI COI LÀ XONG — 12 cổng, ~8 phút
```

`verify` từ chối chạy nếu `DATABASE_URL` / `REDIS_URL` / `S3_*` không trông như hạ tầng test: bộ
test có `deleteMany` và `obliterate`, chạy nhầm lên production là **mất dữ liệu**, không phải bất
tiện.

## Test — luật cứng

**Test phải ĐỎ được trên mã cũ.** Một bài không bao giờ đỏ được thì không bảo vệ gì.

Cách làm ở repo này: viết bài xong thì **phá đúng thứ nó canh**, xác nhận đúng nó đỏ, rồi khôi
phục. Ghi kết quả phép đo đó vào chú thích đầu file — nó là bằng chứng bài test có răng.

Ví dụ có sẵn để bắt chước: `tests/x9-chen-cong-thuc-6-vector.test.js` (rút gọn regex ba cách,
mỗi cách làm đỏ đúng những bài tương ứng).

## Migration CSDL

- Production dùng `prisma migrate deploy`. **Không dùng `db push`** — nó xoá được cột và dữ liệu.
- ⚠️ **Đọc migration Prisma sinh ra TRƯỚC KHI commit.** `prisma migrate dev` ở repo này sẽ kèm
  `DROP INDEX` cho 11 index GIN/trigram tạo bằng SQL thô, vì `schema.prisma` không diễn đạt được
  `USING gin (... gin_trgm_ops)`. Chạy nguyên bản tự sinh lên production = mất sạch index tìm kiếm,
  **không có lỗi nào được ném ra**. Cổng `scripts/ci/check-destructive-sql.mjs` nay bắt việc này.
- Thay đổi đụng dữ liệu thì diễn tập trước: `scripts/db/migration-rehearsal.sh`.

## Chú thích

Giải thích **VÌ SAO**, không mô tả **CÁI GÌ** — cái gì thì đọc code cũng ra.

Trỏ sang chỗ khác bằng **tên hàm/hằng**, đừng bằng số dòng: số dòng trôi mỗi lần có người thêm
dòng ở file đích. `scripts/ci/check-line-refs.mjs` bắt tham chiếu trỏ vào hư không.

## Commit & pull request

- Một commit = một thay đổi giải thích được. Mô tả **vì sao**, kèm phép đo nếu có claim về hiệu năng.
- Không claim "đã tối ưu" mà không có số trước/sau.
- Không claim "đã vá" mà không có test đỏ-được-trên-mã-cũ.
