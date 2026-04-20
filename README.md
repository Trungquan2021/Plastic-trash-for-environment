# Plastic Trash for Environment - feature focus v7

Bản này bỏ phần đăng nhập để tập trung test tính năng trước, nhưng vẫn giữ backend thật.

## Điểm chính

- Không cần đăng nhập, vào web là dùng ngay
- Backend vẫn lưu session theo thiết bị / trình duyệt
- Chỉ nhận ảnh chụp trực tiếp từ camera
- Chặn ảnh cũ bằng challenge một lần và hash ảnh trùng lặp
- Lưu lịch sử chụp, puzzle và vật thể ghi nhận ở backend
- Có nút reset dữ liệu của thiết bị hiện tại

## Chạy local

1. Sao chép `.env.example` thành `.env`
2. Điền `SESSION_SECRET`
3. Cài thư viện:

```bash
npm install
```

4. Chạy server:

```bash
npm start
```

5. Mở:

```text
http://localhost:3000
```

## Deploy

Bản này cần host có Node.js như Replit, Render, Railway, VPS hoặc hosting Node khác.
Không dùng GitHub Pages nếu muốn backend hoạt động.
