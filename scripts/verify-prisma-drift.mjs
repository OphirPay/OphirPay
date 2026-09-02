#!/usr/bin/env node
/**
 * scripts/verify-prisma-drift.mjs
 *
 * Static Prisma schema ⇄ migration drift check (issue #404).
 *
 * Fails (exit 1) when `prisma/schema.prisma` and the committed migrations
 * under `prisma/migrations` are out of sync, without requiring any database
 * connection. The check works by:
 *
 *   1. Parsing `schema.prisma` into the expected set of models (fields),
 *      enums (values), and their types.
 *   2. Replaying the committed `migration.sql` files in order (CREATE TABLE,
 *      ALTER TABLE ADD COLUMN, CREATE TYPE, ALTER TYPE ADD VALUE, DROP TABLE,
 *      DROP COLUMN) to derive the cumulative database state the migrations
 *      produce.
 *   3. Diffing the two: any model/field/enum/value missing on either side is
 *      reported with a clear line, and the process exits non-zero.
 *
 * This is intentionally a *static* check: it catches the common failure mode
 * ("I edited schema.prisma but forgot a migration") on every PR without
 * spinning up Postgres. A live `prisma migrate diff` against a shadow DB is
 * still performed by the `prisma-validate` job for full fidelity.
 *
 * Usage: node scripts/verify-prisma-drift.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(ROOT, "prisma", "schema.prisma");
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");

/** Strip `//` comments and collapse whitespace from a schema line. */
function cleanLine(raw) {
  return raw.replace(/\/\/.*$/, "").trim();
}

/** Parse schema.prisma into { models, enums }. */
export function parseSchema(content) {
  const models = {};
  const enums = {};
  let block = null; // "model" | "enum"
  let name = "";

  for (const rawLine of content.split("\n")) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    if (!block) {
      let m = line.match(/^model\s+(\w+)\s*\{/);
      if (m) {
        block = "model";
        name = m[1];
        models[name] = { fields: {} };
        continue;
      }
      m = line.match(/^enum\s+(\w+)\s*\{/);
      if (m) {
        block = "enum";
        name = m[1];
        enums[name] = new Set();
        continue;
      }
      continue;
    }

    if (line === "}") {
      block = null;
      name = "";
      continue;
    }

    if (block === "enum") {
      const v = line.match(/^(\w+)/);
      if (v) enums[name].add(v[1]);
      continue;
    }

    // model block: field lines only (skip @@ directives)
    const field = line.match(/^(\w+)\s+(.+?)(\s+@.*)?$/);
    if (!field || line.startsWith("@@")) continue;
    const fieldName = field[1];
    let fieldType = field[2].trim();

    // Store every field for now; relation fields (types that name another
    // model) are filtered out in a second pass below, after all models have
    // been parsed (handles forward references).
    const isList = fieldType.endsWith("[]");
    if (isList) fieldType = fieldType.slice(0, -2);
    const optional = fieldType.endsWith("?");
    if (optional) fieldType = fieldType.slice(0, -1);
    models[name].fields[fieldName] = {
      name: fieldName,
      type: fieldType,
      optional,
      isList,
    };
  }

  // Second pass: drop relation fields (their type names another model).
  for (const model of Object.values(models)) {
    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (models[field.type] !== undefined) delete model.fields[fieldName];
    }
  }

  return { models, enums };
}

/** Parse all migration.sql files and replay them into a cumulative state. */
export function parseMigrations(dir) {
  const state = { tables: {}, enums: {} };
  if (!fs.existsSync(dir)) return state;

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const entry of entries) {
    const sqlPath = path.join(dir, entry, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf8");
    replaySql(sql, state);
  }
  return state;
}

/** Apply one migration's SQL statements onto `state`. */
export function replaySql(sql, state) {
  for (const stmt of splitStatements(sql)) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;

    let m = trimmed.match(/^CREATE TABLE\s+"?(\w+)"?\s*\((.*)\)\s*;?$/s);
    if (m) {
      const table = m[1];
      const body = m[2];
      state.tables[table] = {};
      for (const line of splitByCommaTopLevel(body)) {
        const col = line.trim();
        if (!col) continue;
        if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)/i.test(col)) continue;
        const cm = col.match(/^"?(\w+)"?\s+"?([A-Za-z]+)(?:\(([^)]*)\))?(\[\])?/);
        if (cm) state.tables[table][cm[1]] = `${cm[2]}${cm[3] ? `(${cm[3]})` : ""}${cm[4] ?? ""}`;
      }
      continue;
    }

    m = trimmed.match(
      /^ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?(\w+)"?\s+"?([A-Za-z]+)(?:\(([^)]*)\))?(\[\])?/i
    );
    if (m) {
      state.tables[m[1]] = state.tables[m[1]] || {};
      state.tables[m[1]][m[2]] = `${m[3]}${m[4] ? `(${m[4]})` : ""}${m[5] ?? ""}`;
      continue;
    }

    m = trimmed.match(
      /^ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+TYPE\s+"?([A-Za-z]+)(?:\(([^)]*)\))?(\[\])?/i
    );
    if (m) {
      const t = state.tables[m[1]];
      if (t) t[m[2]] = `${m[3]}${m[4] ? `(${m[4]})` : ""}${m[5] ?? ""}`;
      continue;
    }

    m = trimmed.match(/^DROP TABLE\s+"?(\w+)"?\s*;?$/i);
    if (m) {
      delete state.tables[m[1]];
      continue;
    }

    m = trimmed.match(/^ALTER TABLE\s+"?(\w+)"?\s+DROP COLUMN\s+"?(\w+)"?/i);
    if (m) {
      const t = state.tables[m[1]];
      if (t) delete t[m[2]];
      continue;
    }

    m = trimmed.match(/^CREATE TYPE\s+"?(\w+)"?\s+AS ENUM\s*\((.*)\)\s*;?$/is);
    if (m) {
      const values = m[2]
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
      state.enums[m[1]] = new Set(values);
      continue;
    }

    m = trimmed.match(
      /^ALTER TYPE\s+"?(\w+)"?\s+ADD VALUE(?:\s+IF NOT EXISTS)?\s+'([^']+)'/i
    );
    if (m) {
      state.enums[m[1]] = state.enums[m[1]] || new Set();
      state.enums[m[1]].add(m[2]);
      continue;
    }
  }
}

/** Split a SQL script into top-level statements separated by `;`.
 *
 * Comment lines (`-- …`) are stripped from the *whole* script first so a
 * `;` appearing inside a comment (e.g. "…return a u64 id; storing it…")
 * cannot split a statement in half. Each resulting chunk therefore starts
 * at the SQL keyword. */
function splitStatements(sql) {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments.split(";");
}

/** Split a CREATE TABLE body on top-level commas (ignoring parens/quotes). */
function splitByCommaTopLevel(body) {
  const parts = [];
  let depth = 0;
  let inQuote = false;
  let current = "";
  for (const ch of body) {
    if (ch === "'") inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Normalize a SQL type to a comparable token. */
function normType(sqlType) {
  if (!sqlType) return "";
  const t = sqlType.trim().toUpperCase().replace(/\s+/g, " ");
  if (t.startsWith("VARCHAR")) return "TEXT";
  if (t.startsWith("TIMESTAMP")) return "TIMESTAMP(3)";
  if (t.startsWith("DOUBLE")) return "DOUBLE PRECISION";
  if (t.startsWith("CHARACTER VARYING")) return "TEXT";
  return t;
}

/** Normalize a Prisma type to the SQL token it maps to. */
function prismaToSql(prismaType, isEnum, isList) {
  let base;
  if (isEnum) {
    base = prismaType;
  } else {
    switch (prismaType) {
      case "String":
        base = "TEXT";
        break;
      case "Int":
        base = "INTEGER";
        break;
      case "BigInt":
        base = "BIGINT";
        break;
      case "Float":
        base = "DOUBLE PRECISION";
        break;
      case "Decimal":
        base = "DECIMAL";
        break;
      case "Boolean":
        base = "BOOLEAN";
        break;
      case "DateTime":
        base = "TIMESTAMP(3)";
        break;
      case "Json":
        base = "JSONB";
        break;
      case "Bytes":
        base = "BYTEA";
        break;
      default:
        base = prismaType;
    }
  }
  return isList ? `${base}[]` : base;
}

/** Diff schema against migration state; print a clear report. */
export function diffSchemaAndMigrations(schema, migrationState) {
  const issues = [];

  // Models → tables
  for (const modelName of Object.keys(schema.models)) {
    const table = migrationState.tables[modelName];
    if (!table) {
      issues.push(`Model '${modelName}' is missing from migrations (no CREATE TABLE found).`);
      continue;
    }
    for (const [fieldName, field] of Object.entries(schema.models[modelName].fields)) {
      const isEnumType = schema.enums[field.type] !== undefined;
      if (isEnumType) {
        // enum-typed column
        if (table[fieldName] === undefined) {
          issues.push(
            `Field '${modelName}.${fieldName}' (enum ${field.type}) is missing from migrations.`
          );
        }
        continue;
      }
      const expected = normType(prismaToSql(field.type, false, field.isList));
      const actual = table[fieldName] ? normType(table[fieldName]) : undefined;
      if (actual === undefined) {
        issues.push(`Field '${modelName}.${fieldName}' is missing from migrations.`);
      } else if (expected && actual !== expected && !actual.startsWith(expected)) {
        issues.push(
          `Field '${modelName}.${fieldName}' type mismatch: schema '${expected}' vs migration '${actual}'.`
        );
      }
    }
  }

  // Tables → models (stale tables)
  for (const tableName of Object.keys(migrationState.tables)) {
    if (!schema.models[tableName]) {
      issues.push(`Table '${tableName}' exists in migrations but has no model in schema.prisma.`);
    }
  }

  // Enums → migration enums
  for (const enumName of Object.keys(schema.enums)) {
    const migrated = migrationState.enums[enumName];
    if (!migrated) {
      issues.push(`Enum '${enumName}' is missing from migrations (no CREATE TYPE found).`);
      continue;
    }
    for (const value of schema.enums[enumName]) {
      if (!migrated.has(value)) {
        issues.push(`Enum '${enumName}' is missing value '${value}' in migrations.`);
      }
    }
  }

  // Migration enums → schema enums (stale values)
  for (const enumName of Object.keys(migrationState.enums)) {
    if (!schema.enums[enumName]) {
      issues.push(`Enum '${enumName}' exists in migrations but not in schema.prisma.`);
      continue;
    }
    for (const value of migrationState.enums[enumName]) {
      if (!schema.enums[enumName].has(value)) {
        issues.push(`Enum '${enumName}' has extra value '${value}' in migrations not in schema.`);
      }
    }
  }

  return issues;
}

function main() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`❌ Schema file not found: ${SCHEMA_PATH}`);
    process.exit(1);
  }
  const schema = parseSchema(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const migrationState = parseMigrations(MIGRATIONS_DIR);

  console.log("🔍 Verifying Prisma schema ⇄ migrations are in sync (no DB required)…");
  const issues = diffSchemaAndMigrations(schema, migrationState);

  if (issues.length === 0) {
    console.log(`✅ Schema and ${Object.keys(migrationState.tables).length} table(s) / ${
      Object.keys(migrationState.enums).length
    } enum(s) from migrations are in sync.`);
    process.exit(0);
  }

  console.error(`❌ Found ${issues.length} drift issue(s):`);
  for (const issue of issues) {
    console.error(`   - ${issue}`);
  }
  console.error("\n💡 Run `npx prisma migrate dev --name <migration>` to create a migration, or update schema.prisma.");
  process.exit(1);
}

// Allow the module to be imported by tests without running main().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
