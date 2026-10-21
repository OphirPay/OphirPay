import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <h1>Welcome to OphirPay</h1>
      <Link href='/docs/api'>API Documentation</Link>
    </div>
  );
}
