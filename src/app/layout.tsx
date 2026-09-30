import { headers } from 'next/headers';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OphirPay'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = headers().get('x-csp-nonce') ?? '';
  return (
    <html lang='en'>
      <head />
      <body>
        {children}
        {nonce && (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__CSP_NONCE__='${nonce}'` }} />
        )}
      </body>
    </html>
  );
}