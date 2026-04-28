"use client";

import { useMemo, useState, useTransition } from "react";

export type ProfileStatus = "pending" | "approved" | "rejected";

export type ProfileRow = {
  id: string;
  email: string;
  phone: string;
  status: ProfileStatus | string;
  createdAt: string | null;
  approvedAt: string | null;
  lastSeenAt: string | null;
};

type Filter = "pending" | "approved" | "rejected" | "all";

function formatDate(value: string | null): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function statusLabel(status: ProfileRow["status"]): { label: string; className: string } {
  if (status === "approved") {
    return {
      label: "Aprovado",
      className: "bg-emerald-500/20 text-emerald-200",
    };
  }
  if (status === "rejected") {
    return {
      label: "Recusado",
      className: "bg-red-500/20 text-red-200",
    };
  }
  return {
    label: "Pendente",
    className: "bg-amber-500/20 text-amber-200",
  };
}

export function AdminProfilesPanel({ initialRows }: { initialRows: ProfileRow[] }) {
  const [rows, setRows] = useState<ProfileRow[]>(initialRows);
  const [filter, setFilter] = useState<Filter>("pending");
  const [feedback, setFeedback] = useState<string>("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => row.status === filter);
  }, [rows, filter]);

  async function applyAction(id: string, action: "approve" | "reject") {
    setPendingId(id);
    setFeedback("");

    try {
      const response = await fetch(`/api/admin/profiles/${id}/${action}`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setFeedback(data.error ?? "Falha ao atualizar cadastro.");
        return;
      }

      const data = (await response.json()) as {
        profile?: { status: string; approvedAt: string | null };
      };
      const newStatus = (data.profile?.status ?? (action === "approve" ? "approved" : "rejected")) as ProfileStatus;
      const approvedAt = data.profile?.approvedAt ?? (action === "approve" ? new Date().toISOString() : null);

      startTransition(() => {
        setRows((prev) =>
          prev.map((row) =>
            row.id === id
              ? {
                  ...row,
                  status: newStatus,
                  approvedAt,
                }
              : row,
          ),
        );
        setFeedback(action === "approve" ? "Cadastro aprovado." : "Cadastro recusado.");
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="glass-panel overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-3 border-b border-border-soft/80 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold">Cadastros</h2>
          <p className="text-xs text-muted">Aprove ou recuse os usuarios para liberar o acesso.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "pending", label: "Pendentes" },
              { id: "approved", label: "Aprovados" },
              { id: "rejected", label: "Recusados" },
              { id: "all", label: "Todos" },
            ] as { id: Filter; label: string }[]
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                filter === option.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border-soft hover:border-primary/60"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {feedback ? (
        <p className="border-b border-border-soft/70 bg-card-soft/40 px-5 py-3 text-xs text-muted">{feedback}</p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="p-5 text-sm text-muted">Nenhum cadastro neste filtro.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-card-soft/80">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-muted">Email</th>
                <th className="px-5 py-3 text-left font-medium text-muted">Telefone</th>
                <th className="px-5 py-3 text-left font-medium text-muted">Status</th>
                <th className="px-5 py-3 text-left font-medium text-muted">Criado em</th>
                <th className="px-5 py-3 text-left font-medium text-muted">Aprovado em</th>
                <th className="px-5 py-3 text-left font-medium text-muted">Ultimo acesso</th>
                <th className="px-5 py-3 text-left font-medium text-muted">Acao</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = statusLabel(row.status);
                const busy = pendingId === row.id || isPending;
                return (
                  <tr key={row.id} className="border-t border-border-soft/70">
                    <td className="px-5 py-3 font-medium">{row.email || row.id}</td>
                    <td className="px-5 py-3">{row.phone || "-"}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted">{formatDate(row.createdAt)}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(row.approvedAt)}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(row.lastSeenAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => applyAction(row.id, "approve")}
                          disabled={busy || row.status === "approved"}
                          className="rounded-lg border border-emerald-400/60 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          onClick={() => applyAction(row.id, "reject")}
                          disabled={busy || row.status === "rejected"}
                          className="rounded-lg border border-red-400/60 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Recusar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
