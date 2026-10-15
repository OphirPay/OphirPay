import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
export async function GET() {
  try {
    const yamlPath = path.join(process.cwd(), 'docs', 'openapi.yaml');
    const fileContents = fs.readFileSync(yamlPath, 'utf8');
    const data = yaml.load(fileContents) as any;
    return NextResponse.json(data);
  } catch (e:any) {
    return NextResponse.json({error:e.message},{status:500});
  }
}
