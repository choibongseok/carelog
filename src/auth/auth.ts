import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export type Role = 'user' | 'clinic';
export interface AuthInfo {
  sub: string;
  role: Role;
}
export type AuthedRequest = Request & { auth: AuthInfo };

export const ROLES_KEY = 'roles';
/** 이 역할의 토큰만 통과시킨다. 토큰 검증은 항상 먼저 수행한다. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthInfo => ctx.switchToHttp().getRequest<AuthedRequest>().auth);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles) return true; // 공개 엔드포인트
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Bearer 토큰이 필요하다');
    let payload: AuthInfo;
    try {
      payload = await this.jwt.verifyAsync<AuthInfo>(token);
    } catch {
      throw new UnauthorizedException('토큰이 유효하지 않다');
    }
    if (!roles.includes(payload.role)) throw new ForbiddenException('이 역할로는 접근할 수 없다');
    req.auth = { sub: payload.sub, role: payload.role };
    return true;
  }
}
