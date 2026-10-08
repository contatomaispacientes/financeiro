import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MonthQuerySchema, Permission, RangeQuerySchema, type Role } from '@financeiro/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

type MonthQuery = { month?: string };
type RangeQuery = { from?: string; to?: string };

/** FLX-06.1: CSV com `;`, decimal com vírgula e BOM para o Excel abrir em UTF-8. */
function csv(header: string[], rows: Array<Array<string | number>>): string {
  const cell = (v: string | number) => {
    const text = typeof v === 'number' ? (v / 100).toFixed(2).replace('.', ',') : v;
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

@ApiTags('reports')
@ApiBearerAuth()
@Roles(...Permission.VIEW_REPORTS)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  dashboard(@Query(new ZodValidationPipe(MonthQuerySchema)) q: MonthQuery, @CurrentUser('role') role: Role) {
    return this.reports.dashboard(q.month, role);
  }

  @Get('cashflow')
  cashflow(@Query(new ZodValidationPipe(RangeQuerySchema)) q: RangeQuery) {
    return this.reports.cashflow(q.from, q.to);
  }

  @Get('expenses-by-category')
  byCategory(@Query(new ZodValidationPipe(MonthQuerySchema)) q: MonthQuery) {
    return this.reports.expensesByCategory(q.month);
  }

  @Get('statement')
  statement(@Query(new ZodValidationPipe(MonthQuerySchema)) q: MonthQuery) {
    return this.reports.statement(q.month);
  }

  @Get('aging')
  aging() {
    return this.reports.aging();
  }

  @Get('cashflow.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async cashflowCsv(@Query(new ZodValidationPipe(RangeQuerySchema)) q: RangeQuery) {
    const { months } = await this.reports.cashflow(q.from, q.to);
    return csv(
      ['Mês', 'Entradas', 'Saídas', 'Resultado', 'Margem %', 'Entradas previstas', 'Saídas previstas', 'Entradas projetadas', 'Saídas projetadas'],
      months.map((m) => [
        m.month,
        m.inDoneCents,
        m.outDoneCents,
        m.resultCents,
        m.marginPct === null ? '' : String(m.marginPct).replace('.', ','),
        m.inForecastCents,
        m.outForecastCents,
        m.inProjectedCents,
        m.outProjectedCents,
      ]),
    );
  }

  @Get('statement.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async statementCsv(@Query(new ZodValidationPipe(MonthQuerySchema)) q: MonthQuery) {
    const rows = await this.reports.statement(q.month);
    return csv(
      ['Data', 'Tipo', 'Descrição', 'Detalhe', 'Valor'],
      rows.map((r) => [r.date.split('-').reverse().join('/'), r.kind === 'IN' ? 'Entrada' : 'Saída', r.title, r.subtitle, r.kind === 'IN' ? r.valueCents : -r.valueCents]),
    );
  }
}
