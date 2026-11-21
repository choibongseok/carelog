import { Body, Controller, Global, HttpCode, Inject, Module, Post, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Kysely } from 'kysely';
import { APP_CONFIG, AppConfig } from '../config';
import { KYSELY } from '../db/db.module';
import type { DB } from '../db/types';
import { AuthGuard, Role } from './auth';
import { verifyPassword } from './password';

class LoginDto {
  @ApiProperty({ example: 'user1@demo.test' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'demo1234' })
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiProperty({ required: false, enum: ['user', 'clinic'], default: 'user' })
  @IsOptional()
  @IsIn(['user', 'clinic'])
  role?: Role;
}

@ApiTags('auth')
@Controller('v1/auth')
class AuthController {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '시드 계정 로그인(JWT 발급). role=clinic 이면 병의원 계정' })
  async login(@Body() dto: LoginDto) {
    const role: Role = dto.role ?? 'user';
    const acct =
      role === 'clinic'
        ? await this.db.selectFrom('clinics').select(['id', 'password_hash']).where('email', '=', dto.email).executeTakeFirst()
        : await this.db.selectFrom('users').select(['id', 'password_hash']).where('email', '=', dto.email).executeTakeFirst();
    // 계정 존재 여부가 드러나지 않게 같은 메시지를 쓴다.
    if (!acct || !verifyPassword(dto.password, acct.password_hash)) throw new UnauthorizedException('이메일 또는 비밀번호가 틀렸다');
    const accessToken = await this.jwt.signAsync({ sub: acct.id, role });
    return { accessToken, tokenType: 'Bearer', expiresIn: 3600, role, id: acct.id };
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.jwtSecret, signOptions: { expiresIn: '1h', algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
    }),
  ],
  controllers: [AuthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  exports: [JwtModule],
})
export class AuthModule {}
