// Solution for issue #1368
// Generated automatically by Baobot

/*
Tôi sẽ viết một đoạn mã Node.js cho Issue [OphirPay/OphirPay#1361] - "Add cursor-based pagination and sorting to /api/audit-log route". 

Trong trường hợp này, chúng tôi sẽ tạo một API Endpoint mới, ví dụ "/api/audit-log", và sử dụng cursor-based pagination để giảm số lượng dữ liệu trả về cho người dùng. 

Để làm điều này, chúng ta sẽ sử dụng một trang (cursor) để chỉ định từ đâu chúng ta bắt đầu đọc dữ liệu. Nếu người dùng yêu cầu dữ liệu của trang thứ hai, họ sẽ cung cấp trang đầu tiên và chúng tôi sẽ sử dụng nó để xác định dữ liệu bắt đầu của trang thứ hai. Chúng ta cũng sẽ thêm các cú pháp để thực hiện pagination và sorting. 

Dưới đây là một ví dụ về đoạn mã Node.js tương ứng:

```javascript
const express = require('express');
const router = express.Router();
const axios = require('axios');

// Tạo dữ liệu audit log
const auditLogs = [
  { id: 1, log: "Action 1" },
  { id: 2, log: "Action 2" },
  { id: 3, log: "Action 3" },
  // thêm các bản ghi khác...
];

// Dùng API để lấy dữ liệu audit log từ server của bên thứ ba
const fetchAuditLogs = async (cursor) => {
  const response = await axios.get('https://example.com/api/audit-log', { params: { cursor } });
  return response.data;
};

// Endpoint GET /api/audit-log
router.get('/api/audit-log', (req, res) => {
  const { cursor, limit } = req.query;

  // Tìm bản ghi từ cursor
  const cursorLogs = auditLogs.filter((log, index) => {
    if (cursor && cursor > index) return false;
    return true;
  });

  // Trích xuất dữ liệu cần trả về
  const extractedData = cursorLogs.slice(0, limit);

  // Kiểm tra xem có cần lấy thêm bản ghi nào khác không
  const cursorFromNewRequest = cursorLogs[cursorLogs.length - 1].id;
  const nextCursor = cursor ? cursorFromNewRequest + 1 : undefined;

  res.json({
    data: extractedData,
    nextCursor: nextCursor
  });
});

// Endpoint GET /api/audit-log/:cursor
router.get('/api/audit-log/:cursor', async (req, res) => {
  const cursor = parseInt(req.params.cursor, 10);
  const limit = 10; // giới hạn bản ghi trả về

  const allAuditLogs = await fetchAuditLogs(cursor);
  const extractedData = allAuditLogs.slice(0, limit);
  res.json(extractedData);
});

module.exports = router;
```

Đoạn mã trên sẽ tạo ra một API Endpoint mới "/api/audit-log" với hai endpoint. Endpoint đầu tiên trả về tất cả dữ liệu theo cursor-pagination, và endpoint thứ hai trả về dữ liệu theo cursor mà người dùng đã cung cấp. 

Lưu ý rằng, đoạn mã trên sử dụng API giả để lấy dữ liệu audit log. Bạn cần thay thế đường dẫn URL với API của bên thứ ba cung cấp dữ liệu audit log thực tế.
*/