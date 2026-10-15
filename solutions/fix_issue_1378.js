// Solution for issue #1378
// Generated automatically by Baobot

/*
Tôi sẽ chọn Issue [OphirPay/OphirPay#1375] "Add QR code payment request generator with configurable amounts and assets (https://github.com/OphirPay/OphirPay/issues/1375)" để giải quyết. Đây là một đoạn mã Node.js đơn giản để tạo yêu cầu thanh toán QR code với các tọa độ số lượng và loại tài sản được cấu hình.

```javascript
const qrCode = require('qrcode');

class QRCodePaymentGenerator {
  constructor(asset, amount) {
    this.asset = asset;
    this.amount = amount;
  }

  generateQRCode() {
    let qrData = `${this.amount}/${this.asset}`;
    let qr = qrCode.toDataURL(qrData);
    return qr;
  }
}

// Sử dụng
const generator = new QRCodePaymentGenerator('USDT', 1000);
const qrCode = generator.generateQRCode();
console.log('QR Code: ', qrCode);
```

Đoạn mã trên chỉ đơn giản tạo một đối tượng mới `QRCodePaymentGenerator`, cấu hình một tọa độ số lượng và loại tài sản, và sau đó sử dụng thư viện `qrcode` để tạo QR Code từ dữ liệu được cấu hình. Nó không phải là giải pháp hoàn chỉnh cho Issue, nhưng nó là một bước đi để tạo ra một phương pháp để tạo QR Code thanh toán với cấu hình số lượng và tài sản. Bạn có thể mở rộng nó để tạo QR Code cho nhiều tài sản hơn, hoặc thêm thông tin bổ sung như mã hoá dữ liệu, v.v.
*/