"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No se pudo iniciar sesión.");
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next; // recarga completa: la cookie recién puesta debe surtir efecto en todo
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form onSubmit={onSubmit} className="card" style={{ width: "100%", maxWidth: 320 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Tito Metralleta</div>
          <div className="card-sub">Inicia sesión para continuar</div>
        </div>
        <input
          className="hb-search"
          placeholder="Usuario"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
        <input
          className="hb-search"
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <div className="error">⚠ {error}</div>}
        <button type="submit" className="rescan" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
