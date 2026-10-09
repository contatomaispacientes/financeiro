import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { DomainException } from '../../common/filters/domain-exception.filter';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const fileNotFound = () => new DomainException('NOT_FOUND', 'Arquivo não encontrado ou link expirado', HttpStatus.NOT_FOUND);

/**
 * Arquivos privados (anexos de despesa, PDFs de contrato). Driver local em `STORAGE_LOCAL_DIR`
 * (volume na VPS); download só por link assinado de curta duração (DSP-NF1). Driver S3: ver changelog da spec 05.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }));
    this.secret = `storage:${config.get('JWT_ACCESS_SECRET', { infer: true })}`;
    if (config.get('STORAGE_DRIVER', { infer: true }) === 's3') {
      this.logger.warn('STORAGE_DRIVER=s3 ainda não implementado; usando o disco local.');
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  /** Caminho público `/api/v1/files/<token>` válido por `ttlSeconds`. */
  signedPath(key: string, ttlSeconds = 300): string {
    const payload = Buffer.from(JSON.stringify({ k: key, e: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    return `/api/v1/files/${payload}.${this.sign(payload)}`;
  }

  async open(token: string): Promise<{ stream: Readable; contentType: string; size: number }> {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw fileNotFound();
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw fileNotFound();

    const { k: key, e: exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { k: string; e: number };
    if (exp < Date.now() / 1000) throw fileNotFound();
    const path = this.path(key);
    const info = await stat(path).catch(() => null);
    if (!info) throw fileNotFound();
    return { stream: createReadStream(path), contentType: CONTENT_TYPES[extname(key)] ?? 'application/octet-stream', size: info.size };
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** Chaves são geradas por nós; mesmo assim nunca sai da pasta raiz. */
  private path(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw fileNotFound();
    return path;
  }
}

/** Tipo e tamanho conferidos pelo conteúdo, não pelo nome (DSP-01.1: PDF ou imagem até 5 MB). */
export function detectFileType(data: Buffer): '.pdf' | '.png' | '.jpg' | '.webp' | null {
  if (data.subarray(0, 4).toString('latin1') === '%PDF') return '.pdf';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}
