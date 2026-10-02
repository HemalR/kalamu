/**
 * HTTP plumbing shared by the per-project server and the hub: which requests
 * may reach Kalamu at all, the JSON body rule, and the `{ error, code? }`
 * envelope every error response uses (SPEC "Local server").
 */
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isIP } from "node:net";
import type { z } from "zod";
import { OperationError } from "@kalamu/core";
import { StoreError } from "@kalamu/core/store";
import { hubBaseUrl } from "./config.js";
import { CliError, errorCode, type ErrorCode } from "./context.js";

/** An error that already knows its response. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/**
 * Whether Kalamu answers to `url`'s host: a loopback name on any port, or
 * the host of the configured base-url — the address a reverse proxy (exe.dev,
 * `tailscale serve`) exposes the hub on. Anything else is a DNS-rebinding
 * page, a cross-site origin, or a proxy nobody told Kalamu about.
 */
const allowed = (url: URL | null, base: URL): boolean =>
  url !== null && (LOOPBACK.has(url.hostname) || url.host === base.host);

/** A Host-header value as a URL under the base-url's scheme, so its default port compares equal spelled out or not. */
const hostUrl = (host: string, base: URL): URL | null => parseUrl(`${base.protocol}//${host}`);

/**
 * A Host a local reverse proxy may substitute for the one the browser sent:
 * an IP literal, or a name that resolves only on this machine (single-label,
 * e.g. the VM's own hostname). A rebinding page's Host is always its own
 * public, dotted DNS name, so neither shape can be one.
 */
const isProxyHop = (url: URL | null): boolean =>
  url !== null && (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 || !url.hostname.includes("."));

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Middleware both servers mount first. The host a request was addressed to
 * (X-Forwarded-Host behind a proxy, else Host) must be allowed — the
 * DNS-rebinding guard. Behind a proxy the Host itself must also be allowed or
 * a proxy hop (see isProxyHop): a rebinding page can add an X-Forwarded-Host to its own
 * same-origin requests, but its Host is always its own DNS name. A
 * state-changing request carrying an Origin must come from an allowed origin —
 * the CSRF guard; `jsonBody` closes the rest of that door.
 */
export function requestGuard(): MiddlewareHandler {
  return async (c, next) => {
    const base = new URL(hubBaseUrl());
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    const forwarded = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
    const direct = hostUrl(host, base);
    const hostOk =
      forwarded === undefined
        ? allowed(direct, base)
        : allowed(hostUrl(forwarded, base), base) && (allowed(direct, base) || isProxyHop(direct));
    if (!hostOk) {
      return c.text(
        `Kalamu does not answer to ${forwarded ?? host}. If that is your address for it (a reverse proxy or ` +
          `tailnet name), run: kalamu config base-url <the URL you open>\n`,
        403,
      );
    }
    const origin = c.req.header("origin");
    // The opaque "null" origin never parses, so it is refused too.
    if (STATE_CHANGING.has(c.req.method) && origin !== undefined && !allowed(parseUrl(origin), base)) {
      throw new HttpError(403, `cross-origin request from ${origin} refused`, "forbidden-origin");
    }
    await next();
  };
}

/**
 * Parse a JSON request body against `schema`. Only `application/json` is
 * accepted: a cross-site page can send text/plain or a form without a CORS
 * preflight, never JSON. `optional` reads a request with no body as `{}`.
 */
export async function jsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  options: { optional?: boolean } = {},
): Promise<z.output<S>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text !== "" || options.optional !== true) {
    if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      throw new HttpError(415, "expected a JSON body (Content-Type: application/json)");
    }
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "invalid JSON body");
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "invalid request body");
  return parsed.data;
}

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  "not-found": 404,
  cycle: 409,
  conflict: 409,
  "invalid-outline": 500,
  error: 400,
};

/**
 * Both servers' `onError`: known errors become `{ error, code? }` — `code`
 * from `errorCode`, so the UI and `--format json` agents see the same names —
 * and anything unexpected a logged 500.
 */
export const handleError: ErrorHandler = (err, c) => {
  const envelope = (code?: string): { error: string; code?: string } =>
    code === undefined ? { error: err.message } : { error: err.message, code };
  if (err instanceof HttpError) return c.json(envelope(err.code), err.status);
  if (err instanceof OperationError || err instanceof StoreError || err instanceof CliError) {
    const code = errorCode(err);
    return c.json(envelope(code === "error" ? undefined : code), STATUS[code]);
  }
  console.error(err);
  return c.json({ error: "internal error" }, 500);
};
