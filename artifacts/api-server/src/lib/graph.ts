let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Azure credentials are not configured");
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to acquire Graph token: ${data.error_description ?? res.status}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

export interface GraphUser {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
  accountEnabled: boolean | null;
}

export class GraphPermissionError extends Error {}

export async function searchDirectoryUsers(query: string): Promise<GraphUser[]> {
  const token = await getGraphToken();
  const escaped = query.replace(/'/g, "''");
  const filter =
    `startswith(displayName,'${escaped}') or ` +
    `startswith(mail,'${escaped}') or ` +
    `startswith(userPrincipalName,'${escaped}') or ` +
    `startswith(givenName,'${escaped}') or ` +
    `startswith(surname,'${escaped}')`;
  const url =
    "https://graph.microsoft.com/v1.0/users?" +
    new URLSearchParams({
      $filter: filter,
      $select: "id,displayName,mail,userPrincipalName,accountEnabled",
      $top: "15",
    }).toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await res.json()) as {
    value?: GraphUser[];
    error?: { code?: string; message?: string };
  };
  if (res.status === 403) {
    throw new GraphPermissionError(
      "The Azure app registration is missing the Microsoft Graph 'User.Read.All' application permission (with admin consent).",
    );
  }
  if (!res.ok) {
    throw new Error(`Graph user search failed (${res.status}): ${data.error?.message ?? ""}`);
  }
  return data.value ?? [];
}
