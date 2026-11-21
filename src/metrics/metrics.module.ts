import { Controller, Get, Global, Header, Module } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Controller('metrics')
class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  render(): Promise<string> {
    return this.metrics.render();
  }
}

@Global()
@Module({ controllers: [MetricsController], providers: [MetricsService], exports: [MetricsService] })
export class MetricsModule {}
