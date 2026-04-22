# Plastic Trash for Environment - GitHub v10

Bản này đã chuyển sang cấu trúc nhiều file để bạn đưa thẳng lên GitHub.

## Điểm chính
- Không có backend
- Không có đăng nhập
- Không có tải ảnh lên
- Chỉ còn 2 chế độ: chụp ảnh và quay video
- AI quét bằng TensorFlow.js + COCO-SSD + MobileNet
- Video đã quay có thể tải xuống lại
- Lịch sử, puzzle, dữ liệu quét lưu trong localStorage
- Blob video lưu bằng IndexedDB

## Cấu trúc file
- `index.html`
- `styles.css`
- `app.js`

## Cách đưa lên GitHub Pages
1. Tạo repo mới trên GitHub
2. Upload 3 file này lên nhánh `main`
3. Vào `Settings` → `Pages`
4. Ở mục `Build and deployment`, chọn:
   - Source: `Deploy from a branch`
   - Branch: `main` / `(root)`
5. Bấm Save
6. Chờ GitHub Pages publish xong rồi mở link

## Lưu ý camera
- Camera trên điện thoại cần HTTPS
- GitHub Pages có HTTPS nên dùng được
- Nếu test local, dùng Live Server hoặc `python -m http.server 8080`

## Gợi ý giai đoạn đổi thưởng công bằng
Bản hiện tại chỉ phù hợp để demo tính năng.
Khi chuyển sang đổi thưởng thật, nên thêm:
- tài khoản người dùng
- mã QR riêng cho từng thùng rác
- token lượt quét dùng một lần
- lưu dấu vân tay ảnh/video phía server
- random audit hoặc duyệt tay một phần
- OTP email hoặc số điện thoại khi đổi thưởng
