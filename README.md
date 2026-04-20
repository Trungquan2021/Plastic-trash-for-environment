# Plastic Trash for Environment

Bản full-stack dùng backend Node.js + Express, chỉ cho phép chụp ảnh trực tiếp từ camera và đăng nhập bằng tài khoản thường.

## Điểm đã sửa ở bản này
- Giữ backend nhưng bỏ lỗi auth mơ hồ kiểu `Có lỗi xảy ra.`
- Đăng nhập bằng **email hoặc tên đăng nhập**
- Tạo tài khoản bằng **họ tên + email + mật khẩu**, có thể thêm tên đăng nhập riêng
- Session được lưu bằng cookie ký số riêng của app, không còn phụ thuộc `express-session` hay `session-file-store`
- Khi backend chưa chạy hoặc API không nối đúng domain, giao diện sẽ báo lỗi rõ hơn

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
- `SESSION_SECRET`: chuỗi bí mật cho cookie đăng nhập

## Ghi chú deploy
- **GitHub Pages tĩnh không chạy được backend Node.js.**
- Nếu bạn muốn web hoạt động đầy đủ, hãy deploy lên nơi có Node runtime như Render, Railway, VPS, hoặc Docker host.
- Dữ liệu hiện được lưu trong thư mục `data/` bằng file JSON, có thể nâng cấp sang MongoDB hoặc PostgreSQL sau.
