import dynamic from 'next/dynamic';

const SwaggerUI = dynamic(() => import('@scalar/nextjs-api-reference').then(mod => mod.SwaggerUI), { ssr: false });

export default function ApiDocs() {
  return <SwaggerUI specUrl='/api/docs' />;
}
