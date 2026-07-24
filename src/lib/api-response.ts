import { NextResponse } from 'next/server';
import { toCamel } from '@/lib/case';

type ApiResponse<T> = {
  data?: T;
  error?: { message: string; code?: string; details?: unknown };
  meta?: Record<string, unknown>;
};

/**
 * Successful response.
 *
 * Payloads are converted from the database's snake_case to the camelCase the
 * UI components read. Doing it here — rather than in each of the sixty-odd
 * route handlers, or by renaming Postgres columns — means both sides stay
 * idiomatic and neither has to know about the other's convention.
 */
export function success<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { data: toCamel(data), meta: meta ? toCamel(meta) : undefined } satisfies ApiResponse<unknown>,
    { status },
  );
}

/**
 * Error response.
 *
 * Not case-converted: `message` and `code` are already the shape clients
 * expect, and `details` often carries database output that is more useful
 * verbatim when debugging.
 */
export function error(message: string, status = 400, code?: string, details?: unknown) {
  return NextResponse.json(
    { error: { message, code, details } } satisfies ApiResponse<never>,
    { status },
  );
}

export function paginated<T>(data: T[], total: number, page: number, pageSize: number, extra?: Record<string, unknown>) {
  return success(data, {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 0,
    ...(extra ?? {}),
  });
}
