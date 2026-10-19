import { NextResponse } from 'next/server';
export async function GET() {
  const html = `<!doctype html><html><head><title>OphirPay API</title><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{margin:0}</style></head><body><script id="api-reference" data-url="/api/docs" data-proxy-url="https://proxy.scalar.com"></script><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`;
  return new NextResponse(html, {headers:{'Content-Type':'text/html'}});
}
