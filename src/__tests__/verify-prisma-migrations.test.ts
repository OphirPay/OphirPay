import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  normalizeType,
  parseSchemaPrisma,
  applySqlStatements,
  compareSchemaAndMigrations,
  verifyPrismaMigrations
} from '../../scripts/verify-prisma-migrations.mjs';

interface ParsedModelField {
  name: string;
  rawType: string;
  normalizedType: string;
  isOptional: boolean;
  isList: boolean;
  isUnique: boolean;
  isId: boolean;
  isEnum: boolean;
  baseType: string;
}

interface ParsedModel {
  fields: Record<string, ParsedModelField>;
  indexes: Array<{ name: string; columns: string[] }>;
  uniqueConstraints: Array<{ name: string; columns: string[] }>;
}

interface ParsedSchema {
  models: Record<string, ParsedModel>;
  enums: Record<string, Set<string>>;
}

interface TableColumn {
  name: string;
  rawType: string;
  normalizedType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
}

interface TableState {
  columns: Record<string, TableColumn>;
  primaryKey: string[];
}

interface IndexState {
  name: string;
  tableName: string;
  columns: string[];
  isUnique: boolean;
}

interface MigrationState {
  tables: Record<string, TableState>;
  enums: Record<string, Set<string>>;
  indexes: Record<string, IndexState>;
}

interface VerificationResult {
  inSync: boolean;
  diffs: Array<{ type: string; entity: string; message: string }>;
  schemaParsed: ParsedSchema;
  migrationState: MigrationState;
}

describe('Prisma Migrations Verification Engine (Offline)', () => {
  const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
  const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');

  describe('Production Schema & Migration Synchronization', () => {
    it('verifies that committed migrations match schema.prisma with zero drift', () => {
      const result = verifyPrismaMigrations(schemaPath, migrationsDir) as VerificationResult;
      expect(result.inSync).toBe(true);
      expect(result.diffs).toHaveLength(0);
      expect(Object.keys(result.schemaParsed.models).length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(result.schemaParsed.enums).length).toBeGreaterThanOrEqual(5);
    });

    it('contains all required models in the parsed schema', () => {
      const result = verifyPrismaMigrations(schemaPath, migrationsDir) as VerificationResult;
      const modelNames = Object.keys(result.schemaParsed.models);
      expect(modelNames).toContain('User');
      expect(modelNames).toContain('Account');
      expect(modelNames).toContain('Payment');
      expect(modelNames).toContain('Batch');
      expect(modelNames).toContain('Recurrence');
      expect(modelNames).toContain('PaymentRequest');
      expect(modelNames).toContain('Webhook');
      expect(modelNames).toContain('Refund');
      expect(modelNames).toContain('NotificationHook');
      expect(modelNames).toContain('ApiKey');
    });

    it('contains all required enums and their full set of values', () => {
      const result = verifyPrismaMigrations(schemaPath, migrationsDir) as VerificationResult;
      const paymentStatus = result.migrationState.enums['PaymentStatus'];
      expect(paymentStatus).toBeDefined();
      expect(paymentStatus.has('CREATED')).toBe(true);
      expect(paymentStatus.has('SIGNED')).toBe(true);
      expect(paymentStatus.has('SUBMITTED')).toBe(true);
      expect(paymentStatus.has('CONFIRMED')).toBe(true);
      expect(paymentStatus.has('PENDING')).toBe(true);
      expect(paymentStatus.has('PROCESSING')).toBe(true);
      expect(paymentStatus.has('COMPLETED')).toBe(true);
      expect(paymentStatus.has('FAILED')).toBe(true);
      expect(paymentStatus.has('CANCELLED')).toBe(true);
    });
  });

  describe('normalizeType()', () => {
    it('standardizes text types', () => {
      expect(normalizeType('String')).toBe('TEXT');
      expect(normalizeType('TEXT')).toBe('TEXT');
      expect(normalizeType('VARCHAR(255)')).toBe('TEXT');
    });

    it('standardizes integer and numeric types', () => {
      expect(normalizeType('Int')).toBe('INTEGER');
      expect(normalizeType('INTEGER')).toBe('INTEGER');
      expect(normalizeType('BigInt')).toBe('BIGINT');
      expect(normalizeType('Float')).toBe('DOUBLE PRECISION');
      expect(normalizeType('DOUBLE PRECISION')).toBe('DOUBLE PRECISION');
      expect(normalizeType('Decimal(18, 7)')).toBe('DECIMAL(18,7)');
      expect(normalizeType('DECIMAL(18,7)')).toBe('DECIMAL(18,7)');
    });

    it('standardizes boolean and timestamp types', () => {
      expect(normalizeType('Boolean')).toBe('BOOLEAN');
      expect(normalizeType('DateTime')).toBe('TIMESTAMP(3)');
      expect(normalizeType('TIMESTAMP(3)')).toBe('TIMESTAMP(3)');
    });

    it('standardizes array types', () => {
      expect(normalizeType('String[]')).toBe('TEXT[]');
      expect(normalizeType('TEXT[]')).toBe('TEXT[]');
    });
  });

  describe('parseSchemaPrisma()', () => {
    it('parses models and enums with field types and attributes', () => {
      const mockSchema = `
        enum Role {
          ADMIN
          USER
        }

        model Customer {
          id        String   @id @default(cuid())
          email     String   @unique
          role      Role     @default(USER)
          balance   Decimal  @db.Decimal(18, 7)
          createdAt DateTime @default(now())
          orders    Order[]
        }

        model Order {
          id         String   @id
          customerId String
          customer   Customer @relation(fields: [customerId], references: [id])
          @@index([customerId])
        }
      `;

      const parsed = parseSchemaPrisma(mockSchema) as ParsedSchema;
      expect(parsed.enums['Role']).toBeDefined();
      expect(parsed.enums['Role'].has('ADMIN')).toBe(true);
      expect(parsed.enums['Role'].has('USER')).toBe(true);

      expect(parsed.models['Customer']).toBeDefined();
      expect(parsed.models['Customer'].fields['email'].isUnique).toBe(true);
      expect(parsed.models['Customer'].fields['balance'].normalizedType).toBe('DECIMAL(18,7)');
      expect(parsed.models['Customer'].fields['orders']).toBeUndefined();

      expect(parsed.models['Order']).toBeDefined();
      expect(parsed.models['Order'].indexes).toHaveLength(1);
      expect(parsed.models['Order'].indexes[0].columns).toEqual(['customerId']);
    });
  });

  describe('applySqlStatements() & parseMigrations()', () => {
    it('accumulates table creations, alterations, enums, and indexes', () => {
      const state: MigrationState = { tables: {}, enums: {}, indexes: {} };
      
      const sql1 = `
        CREATE TYPE "Status" AS ENUM ('ACTIVE', 'INACTIVE');
        CREATE TABLE "Item" (
          "id" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "price" DOUBLE PRECISION NOT NULL,
          "status" "Status" NOT NULL DEFAULT 'ACTIVE',
          CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
        );
      `;
      applySqlStatements(sql1, state);

      expect(state.enums['Status'].has('ACTIVE')).toBe(true);
      expect(state.tables['Item'].columns['price'].normalizedType).toBe('DOUBLE PRECISION');

      const sql2 = `
        ALTER TYPE "Status" ADD VALUE 'PENDING';
        ALTER TABLE "Item" ALTER COLUMN "price" TYPE DECIMAL(18,7);
        ALTER TABLE "Item" ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX "Item_status_idx" ON "Item"("status");
      `;
      applySqlStatements(sql2, state);

      expect(state.enums['Status'].has('PENDING')).toBe(true);
      expect(state.tables['Item'].columns['price'].normalizedType).toBe('DECIMAL(18,7)');
      expect(state.tables['Item'].columns['stock'].normalizedType).toBe('INTEGER');
      expect(state.indexes['Item_status_idx']).toBeDefined();
      expect(state.indexes['Item_status_idx'].columns).toEqual(['status']);
    });
  });

  describe('compareSchemaAndMigrations() Drift Detection', () => {
    it('detects missing enum values', () => {
      const schema: ParsedSchema = {
        models: {},
        enums: {
          TxStatus: new Set(['INIT', 'SETTLED', 'FAILED'])
        }
      };
      const migrations: MigrationState = {
        tables: {},
        enums: {
          TxStatus: new Set(['INIT', 'FAILED'])
        },
        indexes: {}
      };

      const diffs = compareSchemaAndMigrations(schema, migrations);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('MISSING_ENUM_VALUE');
      expect(diffs[0].entity).toBe('TxStatus.SETTLED');
    });

    it('detects missing models/tables', () => {
      const schema: ParsedSchema = {
        models: {
          AuditLog: { fields: {}, indexes: [], uniqueConstraints: [] }
        },
        enums: {}
      };
      const migrations: MigrationState = { tables: {}, enums: {}, indexes: {} };

      const diffs = compareSchemaAndMigrations(schema, migrations);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('MISSING_TABLE');
      expect(diffs[0].entity).toBe('AuditLog');
    });

    it('detects missing columns and data type mismatches', () => {
      const schema: ParsedSchema = {
        models: {
          Payment: {
            fields: {
              id: {
                name: 'id',
                rawType: 'String',
                normalizedType: 'TEXT',
                isOptional: false,
                isList: false,
                isUnique: false,
                isId: true,
                isEnum: false,
                baseType: 'String'
              },
              amount: {
                name: 'amount',
                rawType: 'Decimal',
                normalizedType: 'DECIMAL(18,7)',
                isOptional: false,
                isList: false,
                isUnique: false,
                isId: false,
                isEnum: false,
                baseType: 'Decimal'
              },
              notes: {
                name: 'notes',
                rawType: 'String',
                normalizedType: 'TEXT',
                isOptional: true,
                isList: false,
                isUnique: false,
                isId: false,
                isEnum: false,
                baseType: 'String'
              }
            },
            indexes: [],
            uniqueConstraints: []
          }
        },
        enums: {}
      };
      const migrations: MigrationState = {
        tables: {
          Payment: {
            columns: {
              id: { name: 'id', rawType: 'TEXT', normalizedType: 'TEXT', isNullable: false },
              amount: { name: 'amount', rawType: 'DOUBLE PRECISION', normalizedType: 'DOUBLE PRECISION', isNullable: false }
            },
            primaryKey: ['id']
          }
        },
        enums: {},
        indexes: {}
      };

      const diffs = compareSchemaAndMigrations(schema, migrations);
      expect(diffs.some(d => d.type === 'MISSING_COLUMN' && d.entity === 'Payment.notes')).toBe(true);
      expect(diffs.some(d => d.type === 'TYPE_MISMATCH' && d.entity === 'Payment.amount')).toBe(true);
    });

    it('detects missing indexes', () => {
      const schema: ParsedSchema = {
        models: {
          Account: {
            fields: {
              id: {
                name: 'id',
                rawType: 'String',
                normalizedType: 'TEXT',
                isOptional: false,
                isList: false,
                isUnique: false,
                isId: true,
                isEnum: false,
                baseType: 'String'
              },
              userId: {
                name: 'userId',
                rawType: 'String',
                normalizedType: 'TEXT',
                isOptional: false,
                isList: false,
                isUnique: false,
                isId: false,
                isEnum: false,
                baseType: 'String'
              }
            },
            indexes: [{ name: 'Account_userId_idx', columns: ['userId'] }],
            uniqueConstraints: []
          }
        },
        enums: {}
      };
      const migrations: MigrationState = {
        tables: {
          Account: {
            columns: {
              id: { name: 'id', rawType: 'TEXT', normalizedType: 'TEXT', isNullable: false },
              userId: { name: 'userId', rawType: 'TEXT', normalizedType: 'TEXT', isNullable: false }
            },
            primaryKey: ['id']
          }
        },
        enums: {},
        indexes: {}
      };

      const diffs = compareSchemaAndMigrations(schema, migrations);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('MISSING_INDEX');
      expect(diffs[0].entity).toBe('Account(userId)');
    });
  });
});
