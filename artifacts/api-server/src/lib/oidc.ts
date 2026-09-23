import * as client from "openid-client";
import type { Request } from "express";

let configPromise: Promise<client.Configuration> | undefined;

export function getOidcConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        "Missing AZURE_TENANT_ID, AZURE_CLIENT_ID, or AZURE_CLIENT_SECRET",
      );
    }
    configPromise = client.discovery(
      new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`),
      clientId,
      clientSecret,
    );
  }
  return configPromise;
}

const HOST_PATTERN = /^[a-zA-Z0-9.-]+(:\d+)?$/;

export function getRedirectUri(req: Request): string {
  const frontendUrl = process.env.FRONTEND_URL;

  if (frontendUrl) {
    const url = new URL(frontendUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid FRONTEND_URL protocol");
    }

    return `${url.origin}/api/auth/callback`;
  }

  // Fallback for production environments where the public host
  // is supplied through the request/proxy.
  const proto = req.protocol === "https" ? "https" : "http";
  const forwardedHost = req.get("x-forwarded-host");
  const firstHop = forwardedHost?.split(",")[0]?.trim();
  const host = firstHop || req.get("host") || "";

  if (!HOST_PATTERN.test(host)) {
    throw new Error("Invalid request host for redirect URI");
  }

  return `${proto}://${host}/api/auth/callback`;
}
