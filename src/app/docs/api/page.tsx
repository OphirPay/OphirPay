import { ApiReference } from '@scalar/nextjs-api-reference'

export const metadata = {
  title: 'OphirPay API Docs | Interactive',
}

export default function ApiDocsPage() {
  return (
    <ApiReference
      configuration={{
        url: '/api/openapi.json',
        theme: 'kepler',
        layout: 'modern',
        darkMode: true,
        servers: [
          { url: 'https://api-testnet.ophirpay.xyz', description: 'Stellar Testnet' },
          { url: 'http://localhost:3000', description: 'Local Dev' },
        ],
      }}
    />
  )
}
