import { BadRequestException, Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { Auth, AuthInfo, Roles } from '../auth/auth';
import { MAX_BATCH } from '../domain/validation';
import { IngestResult, IngestService } from './ingest.service';

class BatchDto {
  @ApiProperty({ required: false, example: 'cgm-001', description: '보낸 기기 식별자(원본에만 남긴다)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;

  @ApiProperty({
    description: `기록 배열(최대 ${MAX_BATCH}건). eventId 는 클라이언트가 만든 멱등 키, measuredAt 은 측정 시각(ISO 8601)`,
    example: [
      { eventId: 'cgm001-20261102T0800', type: 'glucose', measuredAt: '2026-11-02T08:00:00Z', mgdl: 112 },
      { eventId: 'meal-20261102T0830', type: 'meal', measuredAt: '2026-11-02T08:30:00Z', carbsG: 55, label: '아침' },
      { eventId: 'act-20261102T1800', type: 'activity', measuredAt: '2026-11-02T18:00:00Z', activityType: 'walk', durationMin: 30 },
    ],
  })
  @IsArray()
  @ArrayMaxSize(MAX_BATCH)
  events!: unknown[];
}

@ApiTags('ingest')
@ApiBearerAuth()
@Controller('v1/logs')
class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post('batch')
  @HttpCode(200)
  @Roles('user')
  @ApiOperation({ summary: '혈당·식사·활동 기록 배치 수집(멱등)', description: '같은 eventId 는 한 번만 반영한다. 잘못된 항목만 rejected 로 돌려준다.' })
  batch(@Auth() auth: AuthInfo, @Body() dto: BatchDto): Promise<IngestResult> {
    if (dto.events.length === 0) throw new BadRequestException('events 가 비어 있다');
    return this.ingest.ingest(auth.sub, dto.deviceId, dto.events);
  }
}

@Module({ controllers: [IngestController], providers: [IngestService], exports: [IngestService] })
export class IngestModule {}
