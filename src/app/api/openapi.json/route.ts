// SPDX-License-Identifier: MIT
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

export async function GET() {
  try {
    const yamlPath = path.join(process.cwd(), "docs", "openapi.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    const parsed = yaml.load(yamlContent);
    return NextResponse.json(parsed, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load OpenAPI specification" },
      { status: 500 }
    );
  }
}
