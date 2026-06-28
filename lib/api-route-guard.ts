import type { NextRequest } from "next/server";
import { apiError } from "./platform/shared-base-utils";
import { assertRead, assertWrite, type AccessUser } from "./platform/shared-access";
import { getActor } from "./platform/shared-auth";

type GetActorOptions = Parameters<typeof getActor>[1];
type ApiActorRequest = Parameters<typeof getActor>[0];
type RouteContext = unknown;
type GuardedHandler<Context = RouteContext> = (
  request: NextRequest,
  actor: AccessUser,
  context: Context,
) => Response | Promise<Response>;

type ApiGuardOptions = {
  errorMessage: string;
  allowPasswordChangeRequired?: boolean;
};

export async function requireApiActor(request: ApiActorRequest, options?: GetActorOptions) {
  return getActor(request, options);
}

export async function requireApiRead(request: ApiActorRequest, area: string, options?: GetActorOptions) {
  const actor = await requireApiActor(request, options);
  assertRead(actor, area);
  return actor;
}

export async function requireApiWrite(request: ApiActorRequest, area: string, options?: GetActorOptions) {
  const actor = await requireApiActor(request, options);
  assertWrite(actor, area);
  return actor;
}

export function withApiAuth<Context = RouteContext>(
  handler: GuardedHandler<Context>,
  options: ApiGuardOptions,
) {
  return async function guardedApiRoute(request: NextRequest, context: Context) {
    try {
      const actor = await getActor(request, {
        allowPasswordChangeRequired: options.allowPasswordChangeRequired,
      });
      return await handler(request, actor, context);
    } catch (error: unknown) {
      return apiError(error, options.errorMessage);
    }
  };
}

export function withApiPermission<Context = RouteContext>(
  area: string,
  action: "read" | "write",
  handler: GuardedHandler<Context>,
  options: ApiGuardOptions,
) {
  return withApiAuth<Context>(async (request, actor, context) => {
    if (action === "write") {
      assertWrite(actor, area);
    } else {
      assertRead(actor, area);
    }
    return handler(request, actor, context);
  }, options);
}

export function withApiRead<Context = RouteContext>(
  area: string,
  handler: GuardedHandler<Context>,
  options: ApiGuardOptions,
) {
  return withApiPermission(area, "read", handler, options);
}

export function withApiWrite<Context = RouteContext>(
  area: string,
  handler: GuardedHandler<Context>,
  options: ApiGuardOptions,
) {
  return withApiPermission(area, "write", handler, options);
}
