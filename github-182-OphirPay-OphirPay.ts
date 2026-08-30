// src/api-key/entities/api-key.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ApiKeyUsage } from './api-key-usage.entity';
import { ApiKeyRevocationAudit } from './api-key-revocation-audit.entity';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, unique: true })
  keyHash: string;

  @Column({ length: 255 })
  name: string;

  @Column({ nullable: true })
  lastUsedAt: Date;

  @Column({ nullable: true })
  revokedAt: Date;

  @Column({ default: false })
  isRevoked: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ApiKeyUsage, usage => usage.apiKey)
  usages: ApiKeyUsage[];

  @OneToMany(() => ApiKeyRevocationAudit, audit => audit.apiKey)
  revocationAudits: ApiKeyRevocationAudit[];
}

// src/api-key/entities/api-key-usage.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { ApiKey } from './api-key.entity';

@Entity('api_key_usages')
export class ApiKeyUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({ nullable: true })
  ip?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => ApiKey, apiKey => apiKey.usages, { onDelete: 'CASCADE' })
  apiKey: ApiKey;
}

// src/api-key/entities/api-key-revocation-audit.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { ApiKey } from './api-key.entity';

@Entity('api_key_revocation_audits')
export class ApiKeyRevocationAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  revokedByUserId: string;

  @Column({ nullable: true })
  reason?: string;

  @CreateDateColumn()
  revokedAt: Date;

  @Column({ type: 'timestamp' })
  effectiveAt: Date;

  @ManyToOne(() => ApiKey, apiKey => apiKey.revocationAudits, { onDelete: 'CASCADE' })
  apiKey: ApiKey;
}

// src/api-key/api-key.service.ts
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from './entities/api-key.entity';
import { ApiKeyUsage } from './entities/api-key-usage.entity';
import { ApiKeyRevocationAudit } from './entities/api-key-revocation-audit.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { User } from '../user/entities/user.entity';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKey)
    private apiKeyRepo: Repository<ApiKey>,
    @InjectRepository(ApiKeyUsage)
    private apiKeyUsageRepo: Repository<ApiKeyUsage>,
    @InjectRepository(ApiKeyRevocationAudit)
    private apiKeyRevocationAuditRepo: Repository<ApiKeyRevocationAudit>,
  ) {}

  async createApiKey(createApiKeyDto: CreateApiKeyDto, user: User): Promise<ApiKey> {
    const apiKey = this.apiKeyRepo.create({
      ...createApiKeyDto,
      keyHash: this.hashApiKey(createApiKeyDto.key),
      user,
    });
    return await this.apiKeyRepo.save(apiKey);
  }

  async authenticateApiKey(key: string, ip?: string, userAgent?: string): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepo.findOne({ where: { keyHash: this.hashApiKey(key) } });
    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    // Update lastUsedAt and record usage
    await this.apiKeyRepo.update(apiKey.id, { lastUsedAt: new Date() });
    await this.apiKeyUsageRepo.save({
      apiKey,
      timestamp: new Date(),
      ip,
      userAgent,
    });

    return apiKey;
  }

  async revokeApiKey(apiKeyId: string, revokedBy: User, reason?: string): Promise<void> {
    const apiKey = await this.apiKeyRepo.findOne({ where: { id: apiKeyId } });
    if (!apiKey) {
      throw new UnauthorizedException('API key not found');
    }

    if (apiKey.revokedAt) {
      throw new ConflictException('API key is already revoked');
    }

    const now = new Date();
    await this.apiKeyRepo.update(apiKeyId, {
      revokedAt: now,
      isRevoked: true,
    });

    await this.apiKeyRevocationAuditRepo.save({
      apiKey,
      revokedByUserId: revokedBy.id,
      reason,
      revokedAt: now,
      effectiveAt: now,
    });
  }

  private hashApiKey(key: string): string {
    // In production, use a secure hash (e.g., SHA-256) and store only the hash
    // This is a placeholder for brevity
    return require('crypto').createHash('sha256').update(key).digest('hex');
  }
}