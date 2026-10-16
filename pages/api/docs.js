import { NextApiRequest, NextApiResponse } from 'next';
import { serve } from '@scalar/nextjs-api-reference';
import openApiSpec from '../../docs/openapi.yaml';

export default function handler(req, res) {
  serve(req, res, openApiSpec);
}
