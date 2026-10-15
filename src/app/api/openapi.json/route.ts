import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'docs/openapi.yaml')
    const file = fs.readFileSync(filePath, 'utf8')
    const doc = yaml.load(file)
    return NextResponse.json(doc, {
      headers: { 'Cache-Control': 'public, s-maxage=3600' }
    })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load OpenAPI spec' }, { status: 500 })
  }
}