// Solution for issue #1375
// Generated automatically by Baobot

const OphirPay = require('./OphirPay'); // Assuming OphirPay is a module

async function generateQRCodePaymentRequest(amount, asset, clientId) {
  try {
    const ophirPay = new OphirPay();
    const paymentRequest = await ophirPay.generateQRCodePaymentRequest(amount, asset, clientId);
    console.log('Generated QR code payment request:', paymentRequest);
  } catch (error) {
    console.error('Error generating QR code payment request:', error);
  }
}

generateQRCodePaymentRequest(10.5, 'ETH', 'user123');
generateQRCodePaymentRequest(5, 'USDT', 'user456');


This script assumes that there is a module `OphirPay` that has a method `generateQRCodePaymentRequest` which takes `amount`, `asset`, and `clientId` as parameters and returns a payment request. The `generateQRCodePaymentRequest` function is called twice with different amounts and assets to demonstrate the usage. Adjust the `OphirPay` and `generateQRCodePaymentRequest` function as necessary based on the actual implementation.