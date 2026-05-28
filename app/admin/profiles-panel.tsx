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
    <section className="surface-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border-soft px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-display-tight text-lg text-foreground">Cadastros</h2>
          <p className="text-xs text-muted">Aprove ou recuse os usuários para liberar o acesso.</p>
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
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filter === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-soft text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {feedback ? (
        <p className="border-b border-border-soft bg-card-soft px-5 py-3 text-xs text-muted-strong">{feedback}</p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="p-5 text-sm text-muted">Nenhum cadastro neste filtro.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-card-soft">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Email</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Telefone</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Criado em</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Aprovado em</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Último acesso</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-muted">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = statusLabel(row.status);
                const busy = pendingId === row.id || isPending;
                return (
                  <tr key={row.id} className="border-t border-border-soft transition-colors hover:bg-card-soft/40">
                    <td className="px-5 py-3 font-medium text-foreground">{row.email || row.id}</td>
                    <td className="px-5 py-3 text-muted-strong">{row.phone || "-"}</td>
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
                          className="rounded-full bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          onClick={() => applyAction(row.id, "reject")}
                          disabled={busy || row.status === "rejected"}
                          className="rounded-full border border-red-500/40 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
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
