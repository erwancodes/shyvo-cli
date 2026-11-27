import { resolveAuth } from "./config.mjs";

export class ShyvoError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VERSION = "0.1.0";

async function send(baseUrl, path, { method = "POST", body, token } = {}) {
  const headers = {
    accept: "application/json",
    "x-tool-source": "cli",
    "user-agent": `shyvo-cli/${VERSION}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ShyvoError(
      `Cannot reach ${baseUrl} (${error.cause?.code ?? error.message})`,
    );
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error ??
      `${response.status} ${response.statusText}`;
    throw new ShyvoError(message, {
      status: response.status,
      code: payload?.code,
    });
  }
  return payload?.data ?? payload;
}

/** Unauthenticated call, used by the login device flow. */
export const publicRequest = (baseUrl, path, body) =>
  send(baseUrl, path, { body });

/** One registry tool: `POST /api/v1/tools/<name>` with the agent token. */
export async function callTool(name, input = {}, flags = {}) {
  const { baseUrl, token } = await resolveAuth(flags);
  if (!token)
    throw new ShyvoError(
      "Not logged in. Run `shyvo login` or set SHYVO_AGENT_TOKEN.",
      { status: 401 },
    );
  try {
    return await send(baseUrl, `/api/v1/tools/${encodeURIComponent(name)}`, {
      body: input,
      token,
    });
  } catch (error) {
    if (error.status === 401)
      error.message = `${error.message}. The token is invalid, revoked or expired: run \`shyvo login\` again.`;
    if (error.status === 403 && /scope/i.test(error.message))
      error.message = `${error.message}. Ask a human to grant that scope on the agent token in Shyvo (Agents page), or run \`shyvo login\` again with it.`;
    throw error;
  }
}

export async function listTools(flags = {}) {
  const { baseUrl, token } = await resolveAuth(flags);
  return send(baseUrl, "/api/v1/tools", { method: "GET", token });
}
