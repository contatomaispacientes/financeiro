import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

type CheckResult = 'ok' | 'error';

const CHECK_TIMEOUT_MS = 2000;

function probe(task: () => Promise<unknown>): Promise<CheckResult> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref(),
  );
  return Promise.race([task(), timeout]).then(
    () => 'ok',
    () => 'error',
  );
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('maintenance') private readonly queue: Queue,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check (banco e Redis)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.queue.getJobCounts()),
    ]);
    const ok = database === 'ok' && redis === 'ok';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database, redis } };
  }
}
