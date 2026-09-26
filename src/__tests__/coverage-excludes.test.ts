/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import config from '../../vitest.config';

describe('Coverage Excludes', () => {
  it('should only contain paths that exist', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const excludes = (config as any).test?.coverage?.exclude || [];
    
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
