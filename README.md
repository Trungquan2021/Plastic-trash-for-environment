# Plastic Trash for Environment

Bản full-stack dùng backend Node.js + Express, chỉ cho phép chụp ảnh trực tiếp từ camera và đăng nhập bằng email/mật khẩu thông thường.

## Tính năng chính
- Chỉ dùng camera, không có upload ảnh
- Backend lưu tài khoản, session, puzzle, lịch sử quét và vật thể ghi nhận
- Chống ảnh cũ bằng challenge dùng 1 lần và hash ảnh
- Puzzle hiển thị thành bức tranh môi trường xanh

## Chạy local
1. Sao chép `.env.example` thành `.env`
2. Chạy `npm install`
3. Chạy `npm start`
4. Mở `APP_ORIGIN` trong trình duyệt

## Biến môi trường
- `PORT`: cổng chạy server
- `APP_ORIGIN`: domain hoặc URL đang chạy app
- `SESSION_SECRET`: chuỗi bí mật cho session

## Ghi chú
- Khi deploy lên domain thật, hãy đặt `APP_ORIGIN` đúng domain của bạn.
- Dữ liệu hiện được lưu trong thư mục `data/` bằng file JSON, có thể nâng cấp sang MongoDB hoặc PostgreSQL sau.
