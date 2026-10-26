"use client";

import { useState, useTransition } from "react";

type AccessLevel = "READ" | "READ_WRITE";

type McpTokenRecord = {
  id: string;
  name: string;
  tokenPrefix: string;
  accessLevel: AccessLevel;
  isAdmin: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function McpAccessPanel({
  initialTokens,
  endpoint
}: {
  initialTokens: McpTokenRecord[];
  endpoint: string;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("READ");
  const [isAdmin, setIsAdmin] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    setMessage(null);
    setCreatedToken(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, accessLevel, isAdmin })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to create token");
        setTokens((current) => [payload.record as McpTokenRecord, ...current]);
        setCreatedToken(String(payload.token));
        setMessage("Token created. The full key is shown only once.");
        setName("");
        setAccessLevel("READ");
        setIsAdmin(false);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to create token");
      }
    });
  }

  function handleRevoke(id: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, mode: "revoke" })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to revoke token");
        setTokens((current) => current.map((item) => item.id === id ? payload.record as McpTokenRecord : item));
        setMessage("Token revoked.");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to revoke token");
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, mode: "delete" })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to delete token");
        setTokens((current) => current.filter((item) => item.id !== id));
        setMessage("Token deleted.");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to delete token");
      }
    });
  }

  return (
    <section className="panel compact-panel">
      <div className="panel-header">
        <h2 className="panel-title">MCP Access</h2>
      </div>

      <div className="mcp-access-grid">
        <div className="mcp-access-form">
          <label className="field-label">
            Token name
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Read-only token"
              maxLength={120}
            />
          </label>
          <label className="field-label">
            Access level
            <select className="select" value={accessLevel} onChange={(event) => setAccessLevel(event.target.value as AccessLevel)}>
              <option value="READ">READ</option>
              <option value="READ_WRITE">READ_WRITE</option>
            </select>
          </label>
          <label className="check-row">
            <input checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} type="checkbox" />
            Admin access for maintenance tools
          </label>
          <div className="form-row">
            <button className="button primary" disabled={isPending || !name.trim()} onClick={handleCreate} type="button">
              Create token
            </button>
          </div>
          {message ? <div className="badge green">{message}</div> : null}
          {error ? <div className="badge red">{error}</div> : null}
          {createdToken ? (
            <div className="mcp-created-token">
              <strong>Copy the token now:</strong>
              <code>{createdToken}</code>
            </div>
          ) : null}
          <div className="mcp-instructions">
            <p className="muted compact-note">Use this token in any MCP client. Endpoint: `http://127.0.0.1:3101/mcp`.</p>
            <pre className="mcp-code-block"><code>Authorization: Bearer your_token
Endpoint: http://127.0.0.1:3101/mcp</code></pre>
          </div>
        </div>

        <div className="mcp-access-table-wrap">
          <table className="table mcp-access-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Access</th>
                <th>Admin</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td>{token.name}</td>
                  <td><code>{token.tokenPrefix}</code></td>
                  <td><span className={`badge ${token.accessLevel === "READ_WRITE" ? "blue" : "orange"}`}>{token.accessLevel}</span></td>
                  <td>{token.isAdmin ? "Yes" : "No"}</td>
                  <td>{formatDateTime(token.createdAt)}</td>
                  <td>{token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "—"}</td>
                  <td><span className={`badge ${token.revokedAt ? "red" : "green"}`}>{token.revokedAt ? "Revoked" : "Active"}</span></td>
                  <td>
                    {token.revokedAt ? (
                      <button className="button" disabled={isPending} onClick={() => handleDelete(token.id)} type="button">
                        Delete
                      </button>
                    ) : (
                      <button className="button" disabled={isPending} onClick={() => handleRevoke(token.id)} type="button">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!tokens.length ? (
                <tr>
                  <td className="muted" colSpan={8}>No tokens yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
