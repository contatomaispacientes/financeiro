import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { StorageService } from './storage.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  /** Download por link assinado (o token é a autorização, válido por poucos minutos). */
  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Baixar arquivo privado por link assinado' })
  async download(@Param('token') token: string, @Res() res: Response) {
    const file = await this.storage.open(token);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.pipe(res);
  }
}
