# Plastic Trash for Environment

## Chạy local

1. Sao chép `.env.example` thành `.env`
2. Điền Google / Facebook OAuth key
3. Cài thư viện: `npm install`
4. Chạy: `npm start`

## Callback URL cần khai báo trên Google và Meta

- Google: `https://your-domain.com/auth/google/callback`
- Facebook: `https://your-domain.com/auth/facebook/callback`

## Ghi chú deploy

- Đây là app Node.js có backend, không deploy đầy đủ bằng GitHub Pages tĩnh.
- Có thể deploy lên Render, Railway, VPS, hoặc bất kỳ host Node.js nào.
- Nếu không đặt `APP_ORIGIN`, server sẽ tự suy ra origin từ request.
- Nếu frontend báo không kết nối được backend `/api`, nghĩa là bạn đang mở phần giao diện nhưng backend chưa chạy hoặc chưa nối cùng domain.
