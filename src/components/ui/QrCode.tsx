import React from 'react';
import QRCode from 'qrcode.react';

interface QrCodeProps {
  amount: string;
  asset: string;
  memo?: string;
}

const QrCode: React.FC<QrCodeProps> = ({ amount, asset, memo }) => {
  const paymentUri = `stellar:${asset}?amount=${amount}${memo ? `&memo=${memo}` : ''}`;

  return (
    <div>
      <QRCode value={paymentUri} />
      <p>Scan to pay: {paymentUri}</p>
    </div>
  );
};

export default QrCode;