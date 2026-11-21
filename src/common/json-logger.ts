import { LoggerService } from '@nestjs/common';
import { currentRequestId } from './request-context';

const LEVELS = ['debug', 'log', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

/** 한 줄 JSON 로그. 요청 안에서 찍으면 requestId 가 자동으로 붙는다. LOG_LEVEL=silent 로 끈다. */
export class JsonLogger implements LoggerService {
  private emit(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const min = process.env.LOG_LEVEL ?? 'log';
    if (min === 'silent') return;
    if (LEVELS.indexOf(level) < LEVELS.indexOf((LEVELS as readonly string[]).includes(min) ? (min as Level) : 'log')) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      context,
      requestId: currentRequestId(),
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      ...extra,
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  }
  log(message: unknown, context?: string) { this.emit('log', message, context); }
  warn(message: unknown, context?: string) { this.emit('warn', message, context); }
  error(message: unknown, trace?: string, context?: string) { this.emit('error', message, context, trace ? { trace } : undefined); }
  debug(message: unknown, context?: string) { this.emit('debug', message, context); }
  /** 구조화 필드를 붙여 찍는다. */
  event(msg: string, fields: Record<string, unknown>, context?: string) { this.emit('log', msg, context, fields); }
}

export const jsonLogger = new JsonLogger();
