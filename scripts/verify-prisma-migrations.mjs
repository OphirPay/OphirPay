#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Normalizes SQL / Prisma data type names to a canonical representation for comparison.
 */
export function normalizeType(rawType) {
  if (!rawType) return '';
  const clean = rawType.replace(/["']/g, '').trim();
  const type = clean.toUpperCase();

  if (type === 'STRING' || type === 'TEXT' || type.startsWith('VARCHAR')) return 'TEXT';
  if (type === 'INT' || type === 'INTEGER') return 'INTEGER';
  if (type === 'BIGINT') return 'BIGINT';
  if (type === 'FLOAT' || type === 'DOUBLE' || type === 'DOUBLE PRECISION') return 'DOUBLE PRECISION';
  if (type.startsWith('DECIMAL') || type.startsWith('NUMERIC')) {
    const match = type.match(/\(([^)]+)\)/);
    return match ? `DECIMAL(${match[1].replace(/\s+/g, '')})` : 'DECIMAL';
  }
  if (type === 'BOOLEAN' || type === 'BOOL') return 'BOOLEAN';
  if (type === 'DATETIME' || type.startsWith('TIMESTAMP')) return 'TIMESTAMP(3)';
  if (type === 'JSON' || type === 'JSONB') return 'JSONB';
  if (type.endsWith('[]')) {
    const inner = normalizeType(type.slice(0, -2));
    return `${inner}[]`;
  }
  // Return clean enum or custom type name
  return clean;
}

/**
 * Parse schema.prisma models, enums, and indexes.
 */
export function parseSchemaPrisma(schemaContent) {
  const models = {};
  const enums = {};

  const lines = schemaContent.split('\n');
  let currentBlock = null;
  let blockName = '';

  for (let rawLine of lines) {
    const lineWithoutComment = rawLine.replace(/\/\/.*$/, '').trim();
    if (!lineWithoutComment) continue;

    if (!currentBlock) {
      const modelMatch = lineWithoutComment.match(/^model\s+(\w+)\s*\{/);
      if (modelMatch) {
        currentBlock = 'model';
        blockName = modelMatch[1];
        models[blockName] = {
          fields: {},
          indexes: [],
          uniqueConstraints: []
        };
        continue;
      }

      const enumMatch = lineWithoutComment.match(/^enum\s+(\w+)\s*\{/);
      if (enumMatch) {
        currentBlock = 'enum';
        blockName = enumMatch[1];
        enums[blockName] = new Set();
        continue;
      }
    } else {
      if (lineWithoutComment.startsWith('}')) {
        currentBlock = null;
        blockName = '';
        continue;
      }

      if (currentBlock === 'enum') {
        const valueMatch = lineWithoutComment.match(/^(\w+)/);
        if (valueMatch) {
          enums[blockName].add(valueMatch[1]);
        }
      } else if (currentBlock === 'model') {
        // Directives
        if (lineWithoutComment.startsWith('@@unique')) {
          const match = lineWithoutComment.match(/@@unique\(\[([^\]]+)\](?:,\s*name:\s*"([^"]+)")?\)/);
          if (match) {
            const cols = match[1].split(',').map(c => c.trim());
            models[blockName].uniqueConstraints.push({
              name: match[2] || `${blockName}_${cols.join('_')}_key`,
              columns: cols
            });
          }
        } else if (lineWithoutComment.startsWith('@@index')) {
          const match = lineWithoutComment.match(/@@index\(\[([^\]]+)\](?:,\s*(?:map:\s*"([^"]+)"|name:\s*"([^"]+)"))?\)/);
          if (match) {
            const cols = match[1].split(',').map(c => c.trim());
            models[blockName].indexes.push({
              name: match[2] || match[3] || `${blockName}_${cols.join('_')}_idx`,
              columns: cols
            });
          }
        } else {
          // Field definition
          const fieldMatch = lineWithoutComment.match(/^(\w+)\s+([^\s@]+)(.*)$/);
          if (fieldMatch) {
            const fieldName = fieldMatch[1];
            let rawType = fieldMatch[2];
            const attributes = fieldMatch[3] || '';

            const isOptional = rawType.endsWith('?');
            const isList = rawType.endsWith('[]');
            const baseType = rawType.replace(/[\?\[\]]/g, '');

            let dbType = null;
            const dbTypeMatch = attributes.match(/@db\.(\w+)(?:\(([^)]+)\))?/);
            if (dbTypeMatch) {
              dbType = dbTypeMatch[2] ? `${dbTypeMatch[1]}(${dbTypeMatch[2].replace(/\s+/g, '')})` : dbTypeMatch[1];
            }

            const isUnique = attributes.includes('@unique');
            const isId = attributes.includes('@id');

            const scalarTypes = ['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'];
            const isScalar = scalarTypes.includes(baseType);
            const isEnum = enums[baseType] !== undefined || (!isScalar && !attributes.includes('@relation'));

            models[blockName].fields[fieldName] = {
              name: fieldName,
              rawType: dbType || (isList ? `${baseType}[]` : baseType),
              normalizedType: normalizeType(dbType || (isList ? `${baseType}[]` : baseType)),
              isOptional,
              isList,
              isUnique,
              isId,
              isEnum,
              baseType
            };

            if (isUnique) {
              models[blockName].uniqueConstraints.push({
                name: `${blockName}_${fieldName}_key`,
                columns: [fieldName]
              });
            }
          }
        }
      }
    }
  }

  // Remove relation fields that refer to other models
  for (const modelName of Object.keys(models)) {
    const model = models[modelName];
    for (const fieldName of Object.keys(model.fields)) {
      const field = model.fields[fieldName];
      const scalarTypes = ['STRING', 'INTEGER', 'BIGINT', 'DOUBLE PRECISION', 'DECIMAL', 'BOOLEAN', 'TIMESTAMP(3)', 'JSONB'];
      const isKnownScalar = scalarTypes.some(t => field.normalizedType.startsWith(t));
      const isKnownEnum = Boolean(enums[field.baseType]);
      if (!isKnownScalar && !isKnownEnum && models[field.baseType]) {
        delete model.fields[fieldName];
      }
    }
  }

  return { models, enums };
}

/**
 * Parse committed SQL migrations and build the cumulative database state.
 */
export function parseMigrations(migrationsDir) {
  const state = {
    tables: {},
    enums: {},
    indexes: {}
  };

  if (!fs.existsSync(migrationsDir)) {
    return state;
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const dirName of entries) {
    const sqlPath = path.join(migrationsDir, dirName, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    applySqlStatements(sqlContent, state);
  }

  return state;
}

/**
 * Apply SQL statements from a migration to the schema state.
 */
export function applySqlStatements(sql, state) {
  const cleanSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    // 1. CREATE TYPE "EnumName" AS ENUM ('val1', 'val2', ...)
    const enumMatch = stmt.match(/CREATE\s+TYPE\s+"?(\w+)"?\s+AS\s+ENUM\s*\(([^)]+)\)/i);
    if (enumMatch) {
      const enumName = enumMatch[1];
      const values = enumMatch[2]
        .split(',')
        .map(v => v.trim().replace(/^['"]|['"]$/g, ''));
      if (!state.enums[enumName]) {
        state.enums[enumName] = new Set();
      }
      values.forEach(v => state.enums[enumName].add(v));
      continue;
    }

    // 2. ALTER TYPE "EnumName" ADD VALUE [IF NOT EXISTS] 'val'
    const alterEnumMatch = stmt.match(/ALTER\s+TYPE\s+"?(\w+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/i);
    if (alterEnumMatch) {
      const enumName = alterEnumMatch[1];
      const val = alterEnumMatch[2];
      if (!state.enums[enumName]) {
        state.enums[enumName] = new Set();
      }
      state.enums[enumName].add(val);
      continue;
    }

    // 3. CREATE TABLE "TableName" (...)
    const createTableMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(([\s\S]+)\)/i);
    if (createTableMatch) {
      const tableName = createTableMatch[1];
      const body = createTableMatch[2];
      if (!state.tables[tableName]) {
        state.tables[tableName] = {
          columns: {},
          primaryKey: []
        };
      }

      const colDefs = splitSqlParams(body);
      for (const colDef of colDefs) {
        const trimmed = colDef.trim();
        if (trimmed.toUpperCase().startsWith('CONSTRAINT') || trimmed.toUpperCase().startsWith('PRIMARY KEY')) {
          const pkMatch = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
          if (pkMatch) {
            state.tables[tableName].primaryKey = pkMatch[1].split(',').map(c => c.trim().replace(/"/g, ''));
          }
          continue;
        }

        // Support column type with quotes (e.g. "PaymentStatus") and with params (e.g. DECIMAL(18,7))
        const colMatch = trimmed.match(/^"?(\w+)"?\s+("?[A-Za-z0-9_]+(?:\([0-9,\s]+\))?(?:\[\])?"?)(.*)$/);
        if (colMatch) {
          const colName = colMatch[1];
          const rawColType = colMatch[2].replace(/"/g, '');
          const rest = colMatch[3] || '';

          state.tables[tableName].columns[colName] = {
            name: colName,
            rawType: rawColType,
            normalizedType: normalizeType(rawColType),
            isNullable: !rest.toUpperCase().includes('NOT NULL'),
            isPrimaryKey: rest.toUpperCase().includes('PRIMARY KEY')
          };
          if (rest.toUpperCase().includes('PRIMARY KEY')) {
            state.tables[tableName].primaryKey.push(colName);
          }
        }
      }
      continue;
    }

    // 4. ALTER TABLE "TableName" ADD COLUMN [IF NOT EXISTS] "ColName" Type ...
    const addColMatch = stmt.match(/ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+("?[A-Za-z0-9_]+(?:\([0-9,\s]+\))?(?:\[\])?"?)(.*)/i);
    if (addColMatch) {
      const tableName = addColMatch[1];
      const colName = addColMatch[2];
      const rawColType = addColMatch[3].replace(/"/g, '');
      const rest = addColMatch[4] || '';

      if (!state.tables[tableName]) {
        state.tables[tableName] = { columns: {}, primaryKey: [] };
      }
      state.tables[tableName].columns[colName] = {
        name: colName,
        rawType: rawColType,
        normalizedType: normalizeType(rawColType),
        isNullable: !rest.toUpperCase().includes('NOT NULL')
      };
      continue;
    }

    // 5. ALTER TABLE "TableName" DROP COLUMN "ColName"
    const dropColMatch = stmt.match(/ALTER\s+TABLE\s+"?(\w+)"?\s+DROP\s+(?:COLUMN\s+)?"?(\w+)"?/i);
    if (dropColMatch) {
      const tableName = dropColMatch[1];
      const colName = dropColMatch[2];
      if (state.tables[tableName] && state.tables[tableName].columns[colName]) {
        delete state.tables[tableName].columns[colName];
      }
      continue;
    }

    // 6. ALTER TABLE "TableName" ALTER COLUMN "ColName" TYPE NewType
    const alterColTypeMatch = stmt.match(/ALTER\s+TABLE\s+"?(\w+)"?\s+ALTER\s+(?:COLUMN\s+)?"?(\w+)"?\s+TYPE\s+("?[A-Za-z0-9_]+(?:\([0-9,\s]+\))?(?:\[\])?"?)/i);
    if (alterColTypeMatch) {
      const tableName = alterColTypeMatch[1];
      const colName = alterColTypeMatch[2];
      const newType = alterColTypeMatch[3].replace(/"/g, '');
      if (state.tables[tableName] && state.tables[tableName].columns[colName]) {
        state.tables[tableName].columns[colName].rawType = newType;
        state.tables[tableName].columns[colName].normalizedType = normalizeType(newType);
      }
      continue;
    }

    // 7. CREATE [UNIQUE] INDEX [IF NOT EXISTS] "IndexName" ON "TableName" (columns)
    const indexMatch = stmt.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?\s*\(([^)]+)\)/i);
    if (indexMatch) {
      const isUnique = Boolean(indexMatch[1]);
      const indexName = indexMatch[2];
      const tableName = indexMatch[3];
      const columns = indexMatch[4].split(',').map(c => c.trim().replace(/"/g, ''));

      state.indexes[indexName] = {
        name: indexName,
        tableName,
        columns,
        isUnique
      };
      continue;
    }

    // 8. DROP INDEX [IF EXISTS] "IndexName"
    const dropIndexMatch = stmt.match(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i);
    if (dropIndexMatch) {
      const indexName = dropIndexMatch[1];
      delete state.indexes[indexName];
      continue;
    }
  }
}

/**
 * Split SQL parameter list respecting parentheses (e.g. DECIMAL(18,7))
 */
function splitSqlParams(str) {
  const result = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;

    if (char === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
}

/**
 * Compares schema datamodel and migration cumulative state.
 * Returns array of drift descriptions.
 */
export function compareSchemaAndMigrations(schemaParsed, migrationState) {
  const diffs = [];

  // 1. Verify Enums
  for (const [enumName, schemaValues] of Object.entries(schemaParsed.enums)) {
    const migrationEnum = migrationState.enums[enumName];
    if (!migrationEnum) {
      diffs.push({
        type: 'MISSING_ENUM',
        entity: enumName,
        message: `Enum "${enumName}" is declared in schema.prisma but missing from committed migrations.`
      });
      continue;
    }

    for (const val of schemaValues) {
      if (!migrationEnum.has(val)) {
        diffs.push({
          type: 'MISSING_ENUM_VALUE',
          entity: `${enumName}.${val}`,
          message: `Enum "${enumName}" has value "${val}" in schema.prisma, but it is not defined in any committed migration.`
        });
      }
    }
  }

  // 2. Verify Models / Tables
  for (const [modelName, model] of Object.entries(schemaParsed.models)) {
    const table = migrationState.tables[modelName];
    if (!table) {
      diffs.push({
        type: 'MISSING_TABLE',
        entity: modelName,
        message: `Model "${modelName}" is defined in schema.prisma but no table "${modelName}" exists in committed migrations.`
      });
      continue;
    }

    // Verify Fields / Columns
    for (const [fieldName, field] of Object.entries(model.fields)) {
      const col = table.columns[fieldName];
      if (!col) {
        diffs.push({
          type: 'MISSING_COLUMN',
          entity: `${modelName}.${fieldName}`,
          message: `Field "${fieldName}" on model "${modelName}" is defined in schema.prisma but missing from migrations.`
        });
        continue;
      }

      const expectedType = field.normalizedType;
      const actualType = col.normalizedType;

      if (expectedType !== actualType) {
        diffs.push({
          type: 'TYPE_MISMATCH',
          entity: `${modelName}.${fieldName}`,
          message: `Field "${fieldName}" on model "${modelName}" has type mismatch: schema expects "${expectedType}", migration defines "${actualType}".`
        });
      }
    }
  }

  // 3. Verify Unique Constraints and Indexes
  for (const [modelName, model] of Object.entries(schemaParsed.models)) {
    for (const expectedIndex of [...model.indexes, ...model.uniqueConstraints]) {
      const match = Object.values(migrationState.indexes).find(idx => {
        if (idx.tableName !== modelName) return false;
        if (idx.columns.length !== expectedIndex.columns.length) return false;
        return idx.columns.every((c, i) => c === expectedIndex.columns[i]);
      });

      const isPk = expectedIndex.columns.length === 1 && migrationState.tables[modelName]?.primaryKey.includes(expectedIndex.columns[0]);

      if (!match && !isPk) {
        diffs.push({
          type: 'MISSING_INDEX',
          entity: `${modelName}(${expectedIndex.columns.join(', ')})`,
          message: `Index/constraint on "${modelName}(${expectedIndex.columns.join(', ')})" in schema.prisma is missing in committed migrations.`
        });
      }
    }
  }

  return diffs;
}

/**
 * Main verification function.
 */
export function verifyPrismaMigrations(schemaPath, migrationsDir) {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const schemaParsed = parseSchemaPrisma(schemaContent);
  const migrationState = parseMigrations(migrationsDir);

  const diffs = compareSchemaAndMigrations(schemaParsed, migrationState);
  return {
    inSync: diffs.length === 0,
    diffs,
    schemaParsed,
    migrationState
  };
}

/**
 * CLI Runner
 */
function main() {
  const schemaPath = path.join(ROOT_DIR, 'prisma', 'schema.prisma');
  const migrationsDir = path.join(ROOT_DIR, 'prisma', 'migrations');

  console.log('🔍 Verifying Prisma schema against committed migrations (offline check)...');
  console.log(`   Schema:     ${path.relative(ROOT_DIR, schemaPath)}`);
  console.log(`   Migrations: ${path.relative(ROOT_DIR, migrationsDir)}`);

  const result = verifyPrismaMigrations(schemaPath, migrationsDir);

  if (result.inSync) {
    console.log('\n✅ SUCCESS: Prisma schema and committed migrations are 100% in sync.');
    console.log(`   Validated ${Object.keys(result.schemaParsed.models).length} models, ${Object.keys(result.schemaParsed.enums).length} enums, and ${Object.keys(result.migrationState.indexes).length} indexes.`);
    process.exit(0);
  } else {
    console.error(`\n❌ ERROR: Schema drift detected (${result.diffs.length} discrepancies):\n`);
    for (const diff of result.diffs) {
      console.error(`  [${diff.type}] ${diff.message}`);
    }
    console.error('\n⚠️  To resolve drift, generate and commit a new Prisma migration:');
    console.error('   npx prisma migrate dev --name <migration_name>');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
