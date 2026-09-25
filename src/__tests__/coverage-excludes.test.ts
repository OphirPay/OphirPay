/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import config from '../../vitest.config';

describe('Coverage Excludes', () => {
  it('should only contain paths that exist', () => {
    const excludes =
      (config as unknown as { test?: { coverage?: { exclude?: string[] } } })
        .test?.coverage?.exclude || [];
    
    // Filter out wildcards that are hard to check directly
    const directFiles = excludes.filter((p: string) => !p.includes('*') && !p.includes('**'));
    
    const missing: string[] = [];
    for (const file of directFiles) {
      if (!fs.existsSync(path.resolve(process.cwd(), file))) {
        missing.push(file);
      }
    }
    
    const duplicates = directFiles.filter((item: string, index: number) => directFiles.indexOf(item) !== index);
    
    expect(missing).toEqual([]);
    expect(duplicates).toEqual([]);
  });
});
