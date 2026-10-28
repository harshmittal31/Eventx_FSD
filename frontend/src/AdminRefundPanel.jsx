import { useCallback, useEffect, useMemo, useState } from "react";

import "./refund-admin.css";

const API_BASE = "http://localhost:5000/api";
const STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "PROCESSING", "REFUNDED", "FAILED"];

// Keep the UI aligned with the backend's permitted refund status transitions.
const ALLOWED_NEXT_STATUSES = {
  PENDING_REVIEW: ["PENDING_REVIEW", "APPROVED", "REJECTED"],
  APPROVED: ["APPROVED", "PROCESSING", "FAILED"],
  PROCESSING: ["PROCESSING", "REFUNDED", "FAILED"],
  FAILED: ["FAILED", "PROCESSING"],
  REJECTED: ["REJECTED"],
  REFUNDED: ["REFUNDED"],
};

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminRefundPanel({ token }) {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState({});

  const loadRefunds = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/refunds`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.message || "Could not load refund requests.");
      const rows = Array.isArray(data.refunds) ? data.refunds : [];
      setRefunds(rows);
      setDrafts((old) => {
        const next = { ...old };
        rows.forEach((r) => {
          if (!next[r.id]) next[r.id] = { status: r.status, adminNote: r.admin_note || "", providerReference: r.provider_reference || "" };
        });
        return next;
      });
    } catch (e) {
      setError(e.message || "Could not load refund requests.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadRefunds(); }, [loadRefunds]);

  const counts = useMemo(() => {
    const result = { total: refunds.length, pending: 0, approved: 0, refunded: 0, rejected: 0 };
    refunds.forEach((r) => {
      const status = String(r.status || "").toUpperCase();
      if (status === "PENDING_REVIEW") result.pending++;
      if (status === "APPROVED" || status === "PROCESSING") result.approved++;
      if (status === "REFUNDED") result.refunded++;
      if (status === "REJECTED" || status === "FAILED") result.rejected++;
    });
    return result;
  }, [refunds]);

  const filtered = refunds.filter((r) => {
    const statusMatch = filter === "ALL" || String(r.status).toUpperCase() === filter;
    const text = `${r.id} ${r.booking_id} ${r.user_id} ${r.event_id} ${r.reason} ${r.provider_reference || ""}`.toLowerCase();
    return statusMatch && text.includes(query.trim().toLowerCase());
  });

  const updateRefund = async (refund) => {
    const draft = drafts[refund.id] || {};
    const status = String(draft.status || "").toUpperCase();
    if (!STATUSES.includes(status)) {
      setError("Choose a valid refund status.");
      return;
    }
    if (["PROCESSING", "REFUNDED"].includes(status) && !String(draft.providerReference || "").trim()) {
      setError("Enter the payment provider reference before marking a refund as PROCESSING or REFUNDED.");
      return;
    }
    if (status === "REJECTED" && !String(draft.adminNote || "").trim()) {
      setError("Add an admin note explaining why the refund request is rejected.");
      return;
    }
    setSavingId(refund.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API_BASE}/refunds/${refund.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          status,
          adminNote: String(draft.adminNote || "").trim() || null,
          providerReference: String(draft.providerReference || "").trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.message || "Could not update refund request.");
      setNotice(data.message || `Refund request #${refund.id} updated.`);
      await loadRefunds();
    } catch (e) {
      setError(e.message || "Could not update refund request.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="staff-card refund-admin-panel" aria-labelledby="refund-admin-title">
      <div className="staff-card-heading refund-heading">
        <div><p className="staff-eyebrow">ADMIN ONLY</p><h2 id="refund-admin-title">Refund management</h2><p className="staff-muted">Review requests and record decisions. This does not transfer money by itself.</p></div>
        <button className="staff-secondary" onClick={loadRefunds} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div className="refund-summary-grid">
        <div><span>Total requests</span><strong>{counts.total}</strong></div>
        <div><span>Pending review</span><strong>{counts.pending}</strong></div>
        <div><span>Approved / processing</span><strong>{counts.approved}</strong></div>
        <div><span>Refunded</span><strong>{counts.refunded}</strong></div>
        <div><span>Rejected / failed</span><strong>{counts.rejected}</strong></div>
      </div>
      <div className="refund-toolbar">
        <input aria-label="Search refunds" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search booking, user, event, provider ref…" />
        <select aria-label="Filter refund status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      {error && <div className="staff-error" role="alert">{error}</div>}
      {notice && <div className="refund-notice" role="status">{notice}</div>}
      {loading && refunds.length === 0 ? <p className="staff-muted">Loading refund requests…</p> : filtered.length === 0 ? <p className="staff-muted">No refund requests match this filter.</p> : (
        <div className="refund-table-wrap">
          <table className="refund-table">
            <thead><tr><th>Request / booking</th><th>Amount & reason</th><th>Current status</th><th>Admin decision</th><th>Save</th></tr></thead>
            <tbody>{filtered.map((r) => {
              const d = drafts[r.id] || { status: r.status, adminNote: r.admin_note || "", providerReference: r.provider_reference || "" };
              return <tr key={r.id}>
                <td><strong>Refund #{r.id}</strong><small>Booking #{r.booking_id} · User #{r.user_id} · Event #{r.event_id}</small><small>Created: {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</small></td>
                <td><strong>{money(r.amount)}</strong><small>{String(r.reason || "—").replaceAll("_", " ")}</small>{r.provider_reference && <small>Provider: {r.provider_reference}</small>}</td>
                <td><span className={`refund-status-pill status-${String(r.status).toLowerCase()}`}>{String(r.status || "").replaceAll("_", " ")}</span>{r.admin_note && <small>Note: {r.admin_note}</small>}</td>
                <td className="refund-edit-cell">
                  <label>Status<select value={d.status} onChange={(e) => setDrafts((old) => ({ ...old, [r.id]: { ...d, status: e.target.value } }))}>
                    {(ALLOWED_NEXT_STATUSES[String(r.status || "").toUpperCase()] || [String(r.status || "").toUpperCase()]).map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                  </select></label>
                  <label>Provider reference<input value={d.providerReference} onChange={(e) => setDrafts((old) => ({ ...old, [r.id]: { ...d, providerReference: e.target.value } }))} placeholder="Payment/refund reference" /></label>
                  <label>Admin note<textarea rows={2} value={d.adminNote} onChange={(e) => setDrafts((old) => ({ ...old, [r.id]: { ...d, adminNote: e.target.value } }))} placeholder="Decision or processing note" /></label>
                </td>
                <td><button className="staff-primary refund-save-button" disabled={savingId === r.id} onClick={() => updateRefund(r)}>{savingId === r.id ? "Saving…" : "Save decision"}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
