import { NextResponse } from 'next/server';

type ApiResponse<T> = {
  data?: T;
  error?: { message: string; code?: string; details?: unknown };
  meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number };
};

export function success<T>(data: T, meta?: ApiResponse<T>['meta'], status = 200) {
  return NextResponse.json({ data, meta } satisfies ApiResponse<T>, { status });
}

export function error(message: string, status = 400, code?: string, details?: unknown) {
  return NextResponse.json({ error: { message, code, details } } satisfies ApiResponse<never>, { status });
}

export function paginated<T>(data: T[], total: number, page: number, pageSize: number) {
  return success(data, {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}