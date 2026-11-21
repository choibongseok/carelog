import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { jsonLogger } from './json-logger';
import { requestContext } from './request-context';
import { MetricsService } from '../metrics/metrics.service';

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** 요청 ID 를 만들고(또는 들어온 값 사용) 응답 헤더·로그·ALS 에 싣는다. 접근 로그와 HTTP 지연 지표도 여기서 남긴다. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      this.metrics.httpDuration.observe({ method: req.method, route, status: String(res.statusCode) }, seconds);
      if (route !== '/metrics' && route !== '/health') {
        requestContext.run({ requestId }, () =>
          jsonLogger.event('http', { method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000) }, 'Http'),
        );
      }
    });
    requestContext.run({ requestId }, () => next());
  }
}
