import { useCallback, useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import "./StaffDashboard.css";
import AdminRefundPanel from "./AdminRefundPanel";
import "./refund-admin.css";

const API_BASE = "http://localhost:5000/api";

export default function StaffDashboard() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("eventx_user") || "null");
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem("jwt_token"));
  const [qrData, setQrData] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({
    totalScans: 0,
    acceptedEntries: 0,
    rejectedScans: 0,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showRefunds, setShowRefunds] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showManageEvents, setShowManageEvents] = useState(false);

  // Admin: User Management
  const [showManageUsers, setShowManageUsers] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [usersSearch, setUsersSearch] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState("ALL");
  const [roleChanging, setRoleChanging] = useState(null); // userId being changed
  const [roleChangeMsg, setRoleChangeMsg] = useState("");
  const [pendingRoles, setPendingRoles] = useState({}); // { userId: selectedRole }
  const [managedEvents, setManagedEvents] = useState([]);
  const [managedEventsLoading, setManagedEventsLoading] = useState(false);
  const [manageEventsError, setManageEventsError] = useState("");
  const [savingEventId, setSavingEventId] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [createEventError, setCreateEventError] = useState("");
  const [createEventMessage, setCreateEventMessage] = useState("");
  const [eventForm, setEventForm] = useState({
    name: "",
    description: "",
    venueName: "",
    eventDate: "",
    rows: 10,
    seatsPerRow: 10,
  });
  const scannerRef = useRef(null);

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE}/tickets/verification-history?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        setError(data.message || "You are not authorized to view scan history.");
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load scan history.");
      }
      setHistory(Array.isArray(data.history) ? data.history : []);
      setStats(data.stats || { totalScans: 0, acceptedEntries: 0, rejectedScans: 0 });
    } catch (err) {
      setError(err.message || "Could not load scan history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  const role = String(user?.role || "").toUpperCase();
  const authorized = Boolean(token && (role === "STAFF" || role === "ADMIN"));

  useEffect(() => {
    if (token && (role === "STAFF" || role === "ADMIN")) fetchHistory();
  }, [token, role, fetchHistory]);

  useEffect(() => {
    if (token && role === "CUSTOMER") {
      window.location.replace("/");
    }
  }, [token, role]);

  const verifyTicket = useCallback(async (rawData) => {
    const value = String(rawData || "").trim();
    if (!value) {
      setError("Scan a QR code or paste the complete QR payload first.");
      return;
    }
    if (!token) {
      setError("Your login session is missing. Log in again from the customer page.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${API_BASE}/tickets/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ qrData: value }),
      });
      const data = await response.json().catch(() => ({}));
      const entry = {
        time: new Date().toLocaleString(),
        success: response.ok && data.success === true,
        message: data.message || `Verification failed (HTTP ${response.status}).`,
        ticket: data.ticket || null,
      };
      setResult(entry);
      // The server writes the audit row before returning the verification response.
      await fetchHistory();
      if (response.status === 401) {
        setError(data.message || "Session expired. Log in again.");
      } else if (response.status === 403) {
        setError(data.message || "Access denied. Staff access is required.");
      }
    } catch (err) {
      setError(err.message || "Could not connect to the verification server.");
    } finally {
      setLoading(false);
    }
  }, [token, fetchHistory]);

  useEffect(() => {
    if (!authorized || !scannerActive || !scannerRef.current) return undefined;
    let scanner;
    let disposed = false;
    try {
      scanner = new Html5QrcodeScanner(
        "eventx-staff-qr-reader",
        { fps: 10, qrbox: { width: 230, height: 230 }, rememberLastUsedCamera: true },
        false
      );
      scanner.render((decodedText) => {
        if (disposed) return;
        setQrData(decodedText);
        setScannerActive(false);
        Promise.resolve(scanner.clear()).catch(() => {});
        verifyTicket(decodedText);
      }, () => {});
    } catch (err) {
      setError(err.message || "Could not start the QR scanner.");
    }
    return () => {
      disposed = true;
      if (scanner) Promise.resolve(scanner.clear()).catch(() => {});
    };
  }, [authorized, scannerActive, verifyTicket]);

  const handleCreateEvent = async (event) => {
    event.preventDefault();
    setCreateEventError("");
    setCreateEventMessage("");

    if (!token || !authorized) {
      setCreateEventError("Only logged-in STAFF or ADMIN accounts can create events.");
      return;
    }
    if (!eventForm.name.trim() || !eventForm.venueName.trim() || !eventForm.eventDate) {
      setCreateEventError("Event name, venue, and date/time are required.");
      return;
    }
    if (Number(eventForm.rows) < 1 || Number(eventForm.seatsPerRow) < 1) {
      setCreateEventError("Rows and seats per row must be at least 1.");
      return;
    }

    setCreatingEvent(true);
    try {
      const response = await fetch(`${API_BASE}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: eventForm.name.trim(),
          description: eventForm.description.trim(),
          venueName: eventForm.venueName.trim(),
          eventDate: eventForm.eventDate,
          rows: Number(eventForm.rows),
          seatsPerRow: Number(eventForm.seatsPerRow),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Event creation failed (HTTP ${response.status}).`);
      }
      const newId = data.eventId ?? data.event?.id ?? data.id;
      const totalSeats = data.totalSeats ?? Number(eventForm.rows) * Number(eventForm.seatsPerRow);
      setCreateEventMessage(`Event created successfully${newId ? ` (ID ${newId})` : ""}. ${totalSeats} seats generated.`);
      setEventForm({ name: "", description: "", venueName: "", eventDate: "", rows: 10, seatsPerRow: 10 });
    } catch (err) {
      setCreateEventError(err.message || "Could not create event.");
    } finally {
      setCreatingEvent(false);
    }
  };

  // Admin: fetch all users
  const fetchAllUsers = useCallback(async () => {
    if (!token || role !== "ADMIN") return;
    setUsersLoading(true);
    setUsersError("");
    try {
      const params = new URLSearchParams({ limit: 100 });
      const response = await fetch(`${API_BASE}/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Could not load users (HTTP ${response.status}).`);
      }
      setAllUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      setUsersError(err.message || "Could not load users.");
    } finally {
      setUsersLoading(false);
    }
  }, [token, role]);

  // Admin: change a user's role
  const applyRoleChange = async (targetUserId, newRole) => {
    if (!targetUserId || !newRole) return;
    const confirmed = window.confirm(
      `Change user #${targetUserId}'s role to ${newRole}? This takes effect immediately.`
    );
    if (!confirmed) return;
    setRoleChanging(targetUserId);
    setRoleChangeMsg("");
    setUsersError("");
    try {
      const response = await fetch(`${API_BASE}/admin/users/${targetUserId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Role update failed (HTTP ${response.status}).`);
      }
      setRoleChangeMsg(data.message || `Role updated to ${newRole} successfully.`);
      // Update local list
      setAllUsers((current) =>
        current.map((u) => u.id === targetUserId ? { ...u, role: newRole } : u)
      );
      setPendingRoles((current) => { const next = { ...current }; delete next[targetUserId]; return next; });
    } catch (err) {
      setUsersError(err.message || "Could not change role.");
    } finally {
      setRoleChanging(null);
    }
  };

  const fetchManagedEvents = useCallback(async () => {
    if (!token || !authorized) return;
    setManagedEventsLoading(true);
    setManageEventsError("");
    try {
      const response = await fetch(`${API_BASE}/events/manage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Could not load events (HTTP ${response.status}).`);
      }
      setManagedEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setManageEventsError(err.message || "Could not load events.");
    } finally {
      setManagedEventsLoading(false);
    }
  }, [token, authorized]);

  const saveEventChanges = async (eventId, changes) => {
    setSavingEventId(eventId);
    setManageEventsError("");
    try {
      const response = await fetch(`${API_BASE}/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || `Could not update event (HTTP ${response.status}).`);
      }
      setManagedEvents((current) => current.map((item) => item.id === eventId ? data.event : item));
      setEditingEvent(null);
    } catch (err) {
      setManageEventsError(err.message || "Could not update event.");
    } finally {
      setSavingEventId(null);
    }
  };

  const logout = () => {
    localStorage.removeItem("jwt_token");
    localStorage.removeItem("eventx_user");
    setToken(null);
    setUser(null);
    setScannerActive(false);
    window.location.replace("/customer");
  };

  const switchToCustomerPortal = () => {
    const confirmed = window.confirm(
      "You will be logged out of your staff account before opening the customer portal. Continue?"
    );
    if (!confirmed) return;
    setScannerActive(false);
    localStorage.removeItem("jwt_token");
    localStorage.removeItem("eventx_user");
    setToken(null);
    setUser(null);
    window.location.replace("/customer");
  };

  if (!authorized) {
    return (
      <main className="staff-page">
        <section className="staff-card staff-access-card">
          <div className="staff-brand-mark">E</div>
          <p className="staff-eyebrow">EVENTX ENTRY CONTROL</p>
          <h1>Staff access required</h1>
          <p>Log in with an account whose role is STAFF or ADMIN. If you just changed your role, log out and log in again to refresh the token.</p>
          <div className="staff-actions">
            <button className="staff-primary" onClick={() => { window.location.href = "/customer"; }}>Go to EventX login</button>
          </div>
        </section>
      </main>
    );
  }

  const scans = stats.totalScans;
  const accepted = stats.acceptedEntries;
  const rejected = stats.rejectedScans;

  // Filtered users for admin panel
  const filteredUsers = allUsers.filter((u) => {
    const q = usersSearch.trim().toLowerCase();
    const matchSearch = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
    const matchRole = usersRoleFilter === "ALL" || String(u.role).toUpperCase() === usersRoleFilter;
    return matchSearch && matchRole;
  });

  return (
    <main className="staff-page">
      <header className="staff-topbar">
        <a className="staff-brand" href="/customer" aria-label="Back to EventX customer page"><span className="staff-brand-mark">E</span><span><strong>EventX</strong><small>ENTRY CONTROL</small></span></a>
        <div className="staff-top-actions">
          <span className="staff-user-chip">{user?.name || "Staff"} · {role}</span>
          {role === "ADMIN" && <button className="staff-secondary" onClick={() => setShowRefunds((value) => !value)}>{showRefunds ? "Close Manage Refunds" : "Manage Refunds"}</button>}
          {role === "ADMIN" && (
            <button className="staff-secondary" onClick={() => {
              const opening = !showManageUsers;
              setShowManageUsers(opening);
              setRoleChangeMsg("");
              setUsersError("");
              if (opening) fetchAllUsers();
            }}>
              {showManageUsers ? "Close Manage Users" : "Manage Users"}
            </button>
          )}
          <button className="staff-secondary" onClick={() => { setShowCreateEvent((value) => !value); setCreateEventError(""); setCreateEventMessage(""); document.getElementById("staff-create-event")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
            {showCreateEvent ? "Close Create Event" : "Create Event"}
          </button>
          <button className="staff-secondary" onClick={() => { const opening = !showManageEvents; setShowManageEvents(opening); if (opening) fetchManagedEvents(); }}>
            {showManageEvents ? "Close Manage Events" : "Manage Events"}
          </button>
          <button className="staff-secondary" onClick={switchToCustomerPortal}>Customer Portal</button>
          <button className="staff-secondary" onClick={logout}>Log out</button>
        </div>
      </header>

      <section className="staff-welcome">
        <div><p className="staff-eyebrow">STAFF WORKSPACE</p><h1>Staff Dashboard</h1><p>Scan a guest's ticket at the entrance. Each QR code can be accepted only once.</p></div>
        <span className="staff-live-badge"><i /> Entry verification ready</span>
      </section>

      {role === "ADMIN" && showRefunds && <AdminRefundPanel token={token} />}

      {role === "ADMIN" && showManageUsers && (
        <section className="staff-card staff-user-mgmt-card" id="staff-manage-users">
          <div className="staff-card-heading">
            <div>
              <p className="staff-eyebrow">ADMIN PANEL</p>
              <h2>Manage Users & Roles</h2>
              <p className="staff-muted">View all accounts and change user roles. You cannot change your own role.</p>
            </div>
            <button className="staff-secondary" onClick={fetchAllUsers} disabled={usersLoading}>
              {usersLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {/* Search + Filter */}
          <div className="staff-user-filters">
            <input
              className="staff-user-search"
              type="search"
              placeholder="Search by name or email…"
              value={usersSearch}
              onChange={(e) => setUsersSearch(e.target.value)}
            />
            <div className="staff-role-filter-buttons">
              {["ALL", "CUSTOMER", "STAFF", "ADMIN"].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`staff-role-filter-btn ${usersRoleFilter === r ? "active" : ""}`}
                  onClick={() => setUsersRoleFilter(r)}
                >{r === "ALL" ? "All Roles" : r}</button>
              ))}
            </div>
          </div>

          {usersError && <div className="staff-error" role="alert">{usersError}</div>}
          {roleChangeMsg && <div className="staff-success" role="status">{roleChangeMsg}</div>}

          {usersLoading && allUsers.length === 0 ? (
            <p className="staff-muted">Loading users…</p>
          ) : filteredUsers.length === 0 ? (
            <p className="staff-muted">No users match your search or filter.</p>
          ) : (
            <div className="staff-user-table-wrap">
              <table className="staff-user-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Current Role</th>
                    <th>Change Role</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const isSelf = String(u.id) === String(user?.id);
                    const currentRole = String(u.role || "CUSTOMER").toUpperCase();
                    const selectedRole = pendingRoles[u.id] || currentRole;
                    return (
                      <tr key={u.id} className={isSelf ? "staff-user-row-self" : ""}>
                        <td className="staff-user-id">#{u.id}</td>
                        <td>
                          <strong>{u.name}</strong>
                          {isSelf && <span className="staff-self-badge">You</span>}
                        </td>
                        <td className="staff-user-email">{u.email}</td>
                        <td>
                          <span className={`staff-role-pill role-${currentRole.toLowerCase()}`}>
                            {currentRole}
                          </span>
                        </td>
                        <td>
                          <div className="staff-role-change-row">
                            <select
                              className="staff-role-select"
                              value={selectedRole}
                              disabled={isSelf || roleChanging === u.id}
                              onChange={(e) => setPendingRoles((prev) => ({ ...prev, [u.id]: e.target.value }))}
                            >
                              {["CUSTOMER", "STAFF", "ADMIN"].map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            <button
                              className="staff-secondary staff-apply-role-btn"
                              disabled={isSelf || roleChanging === u.id || selectedRole === currentRole}
                              onClick={() => applyRoleChange(u.id, selectedRole)}
                            >
                              {roleChanging === u.id ? "Saving…" : "Apply"}
                            </button>
                          </div>
                          {isSelf && <span className="staff-muted" style={{fontSize:"10px"}}>Cannot change own role</span>}
                        </td>
                        <td className="staff-user-date">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="staff-muted" style={{marginTop:"12px", fontSize:"11px"}}>
            Showing {filteredUsers.length} of {allUsers.length} users
          </p>
        </section>
      )}

      {showCreateEvent && (
        <section id="staff-create-event" className="staff-card staff-create-event-card">
          <div className="staff-card-heading">
            <div><p className="staff-eyebrow">EVENT MANAGEMENT</p><h2>Create a new event</h2></div>
            <span className="staff-role-badge">{role} access</span>
          </div>
          <p className="staff-muted">Create an event and generate its seat layout. Only STAFF and ADMIN accounts can submit this form.</p>
          <form className="staff-create-event-form" onSubmit={handleCreateEvent}>
            <label>Event name<input value={eventForm.name} onChange={(e) => setEventForm((v) => ({ ...v, name: e.target.value }))} maxLength={200} required placeholder="e.g. EventX Music Festival" /></label>
            <label>Venue name<input value={eventForm.venueName} onChange={(e) => setEventForm((v) => ({ ...v, venueName: e.target.value }))} maxLength={200} required placeholder="e.g. Delhi Arena" /></label>
            <label className="staff-form-wide">Description<textarea value={eventForm.description} onChange={(e) => setEventForm((v) => ({ ...v, description: e.target.value }))} rows={3} placeholder="Tell guests about this event" /></label>
            <label>Event date and time<input type="datetime-local" value={eventForm.eventDate} onChange={(e) => setEventForm((v) => ({ ...v, eventDate: e.target.value }))} required /></label>
            <label>Number of rows<input type="number" min="1" max="100" value={eventForm.rows} onChange={(e) => setEventForm((v) => ({ ...v, rows: e.target.value }))} required /></label>
            <label>Seats per row<input type="number" min="1" max="100" value={eventForm.seatsPerRow} onChange={(e) => setEventForm((v) => ({ ...v, seatsPerRow: e.target.value }))} required /></label>
            <div className="staff-form-total">Total seats to generate: <strong>{Math.max(0, Number(eventForm.rows) || 0) * Math.max(0, Number(eventForm.seatsPerRow) || 0)}</strong></div>
            <div className="staff-form-wide"><button className="staff-primary" type="submit" disabled={creatingEvent}>{creatingEvent ? "Creating event…" : "Create event and generate seats"}</button></div>
          </form>
          {createEventError && <div className="staff-error" role="alert">{createEventError}</div>}
          {createEventMessage && <div className="staff-success" role="status">{createEventMessage}</div>}
        </section>
      )}

      {showManageEvents && (
        <section className="staff-card staff-manage-events-card" id="staff-manage-events">
          <div className="staff-card-heading">
            <div>
              <p className="staff-eyebrow">EVENT MANAGEMENT</p>
              <h2>Manage events</h2>
              <p className="staff-muted">Edit event details or change an event's status. Existing seats and bookings are preserved.</p>
            </div>
            <button className="staff-secondary" onClick={fetchManagedEvents} disabled={managedEventsLoading}>
              {managedEventsLoading ? "Refreshing…" : "Refresh events"}
            </button>
          </div>

          {manageEventsError && <div className="staff-error" role="alert">{manageEventsError}</div>}
          {managedEventsLoading && managedEvents.length === 0 ? (
            <p className="staff-muted">Loading events…</p>
          ) : managedEvents.length === 0 ? (
            <p className="staff-muted">No events returned. Click Refresh events to try again.</p>
          ) : (
            <div className="staff-managed-events-list">
              {managedEvents.map((eventItem) => {
                const status = String(eventItem.status || "DRAFT").toUpperCase();
                const dateForInput = (value) => {
                  if (!value) return "";
                  const date = new Date(value);
                  if (Number.isNaN(date.getTime())) return "";
                  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
                  return local.toISOString().slice(0, 16);
                };
                const isEditing = editingEvent?.id === eventItem.id;

                return (
                  <article className="staff-managed-event" key={eventItem.id}>
                    <div className="staff-managed-event-top">
                      <div>
                        <span className="staff-event-id">EVENT #{eventItem.id}</span>
                        <h3>{eventItem.name}</h3>
                        <p>{eventItem.venue_name || eventItem.venueName} · {eventItem.event_date ? new Date(eventItem.event_date).toLocaleString() : "Date not set"}</p>
                      </div>
                      <span className={`staff-event-status status-${status.toLowerCase()}`}>{status}</span>
                    </div>
                    {eventItem.description && <p className="staff-muted">{eventItem.description}</p>}

                    {isEditing && (
                      <form className="staff-edit-event-form" onSubmit={(e) => {
                        e.preventDefault();
                        saveEventChanges(eventItem.id, {
                          name: editingEvent.name,
                          description: editingEvent.description,
                          venueName: editingEvent.venueName,
                          eventDate: editingEvent.eventDate,
                        });
                      }}>
                        <label>Event name
                          <input required maxLength={200} value={editingEvent.name} onChange={(e) => setEditingEvent((v) => ({ ...v, name: e.target.value }))} />
                        </label>
                        <label>Venue
                          <input required maxLength={200} value={editingEvent.venueName} onChange={(e) => setEditingEvent((v) => ({ ...v, venueName: e.target.value }))} />
                        </label>
                        <label className="staff-form-wide">Description
                          <textarea rows={3} value={editingEvent.description} onChange={(e) => setEditingEvent((v) => ({ ...v, description: e.target.value }))} />
                        </label>
                        <label>Event date and time
                          <input type="datetime-local" required value={editingEvent.eventDate} onChange={(e) => setEditingEvent((v) => ({ ...v, eventDate: e.target.value }))} />
                        </label>
                        <div className="staff-edit-actions staff-form-wide">
                          <button className="staff-primary" type="submit" disabled={savingEventId === eventItem.id}>{savingEventId === eventItem.id ? "Saving…" : "Save changes"}</button>
                          <button className="staff-secondary" type="button" onClick={() => setEditingEvent(null)}>Cancel edit</button>
                        </div>
                      </form>
                    )}

                    <div className="staff-managed-event-bottom">
                      <span>{Number(eventItem.total_seats || 0)} seats · ID {eventItem.id}</span>
                      {!isEditing && <button className="staff-secondary" onClick={() => setEditingEvent({
                        id: eventItem.id,
                        name: eventItem.name || "",
                        description: eventItem.description || "",
                        venueName: eventItem.venue_name || eventItem.venueName || "",
                        eventDate: dateForInput(eventItem.event_date),
                      })}>Edit details</button>}
                      {status !== "PUBLISHED" && <button className="staff-secondary" disabled={savingEventId === eventItem.id} onClick={() => saveEventChanges(eventItem.id, { status: "PUBLISHED" })}>Publish</button>}
                      {status !== "DRAFT" && <button className="staff-secondary" disabled={savingEventId === eventItem.id} onClick={() => saveEventChanges(eventItem.id, { status: "DRAFT" })}>Set draft</button>}
                      {status !== "COMPLETED" && <button className="staff-secondary" disabled={savingEventId === eventItem.id} onClick={() => saveEventChanges(eventItem.id, { status: "COMPLETED" })}>Mark completed</button>}
                      {status !== "CANCELLED" && <button className="staff-secondary" disabled={savingEventId === eventItem.id} onClick={() => {
                        const ok = window.confirm(`Cancel event “${eventItem.name}”? Existing bookings and tickets will not be deleted.`);
                        if (ok) saveEventChanges(eventItem.id, { status: "CANCELLED" });
                      }}>Cancel event</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="staff-stats" aria-label="Current session scan statistics">
        <article className="staff-stat-card"><span>Total recorded scans</span><strong>{scans}</strong><small>Stored in MySQL</small></article>
        <article className="staff-stat-card"><span>Accepted entries</span><strong className="staff-green-text">{accepted}</strong><small>Verified successfully</small></article>
        <article className="staff-stat-card"><span>Rejected scans</span><strong className="staff-red-text">{rejected}</strong><small>Used, cancelled or invalid</small></article>
      </section>

      <section className="staff-main-grid">
        <article className="staff-card">
          <div className="staff-card-heading"><div><p className="staff-eyebrow">ENTRY CHECK</p><h2>Scan ticket QR</h2></div><span className="staff-camera-icon">▦</span></div>
          <p className="staff-muted">Use the camera on the guest's ticket. Camera access requires localhost or HTTPS.</p>
          <div id="eventx-staff-qr-reader" ref={scannerRef} className="staff-qr-reader" />
          <button className="staff-primary staff-full-button" disabled={loading} onClick={() => { setError(""); setResult(null); setScannerActive((active) => !active); }}>{scannerActive ? "Stop camera scanner" : "Start camera scanner"}</button>
          <div className="staff-divider"><span>OR VERIFY MANUALLY</span></div>
          <label className="staff-label" htmlFor="staff-qr-data">Complete QR payload</label>
          <textarea id="staff-qr-data" className="staff-textarea" value={qrData} onChange={(event) => setQrData(event.target.value)} placeholder="Paste the full signed QR payload here…" rows={4} spellCheck={false} />
          <button className="staff-primary staff-full-button" disabled={loading || !qrData.trim()} onClick={() => verifyTicket(qrData)}>{loading ? "Checking ticket…" : "Verify ticket"}</button>
          {error && <div className="staff-error" role="alert">{error}</div>}
        </article>

        <article className="staff-card staff-result-card">
          <div className="staff-card-heading"><div><p className="staff-eyebrow">SERVER RESPONSE</p><h2>Latest verification</h2></div></div>
          {!result ? <div className="staff-empty-state"><span>✓</span><h3>Ready to check a ticket</h3><p>Scan a QR code or enter its payload. The server will check signature, ticket status and duplicate entry.</p></div> : (
            <div className={`staff-result ${result.success ? "is-valid" : "is-invalid"}`}>
              <div className="staff-result-title"><span className="staff-result-icon">{result.success ? "✓" : "×"}</span><div><h3>{result.success ? "Entry approved" : "Entry rejected"}</h3><p>{result.message}</p></div></div>
              {result.ticket && <div className="staff-ticket-details">
                <div><span>Ticket code</span><strong>{result.ticket.ticket_code ?? result.ticket.ticketCode ?? "—"}</strong></div>
                <div><span>Ticket ID</span><strong>{result.ticket.id ?? result.ticket.ticketId ?? "—"}</strong></div>
                <div><span>Event ID</span><strong>{result.ticket.event_id ?? result.ticket.eventId ?? "—"}</strong></div>
                <div><span>Seat</span><strong>{result.ticket.seat_number ?? result.ticket.seatNumber ?? "—"}</strong></div>
                <div><span>Status</span><strong>{result.ticket.status ?? (result.success ? "USED" : "—")}</strong></div>
              </div>}
              <small className="staff-result-time">Checked at {result.time}</small>
            </div>
          )}
          <div className="staff-entry-note"><strong>Entry rule</strong><p>Only the server's successful first verification approves entry. A previously used ticket must be rejected.</p></div>
        </article>
      </section>

      <section className="staff-card staff-history-card">
        <div className="staff-card-heading"><div><p className="staff-eyebrow">THIS SESSION</p><h2>Recent scans</h2></div><button className="staff-secondary" onClick={fetchHistory} disabled={historyLoading}>{historyLoading ? "Refreshing…" : "Refresh history"}</button></div>
        {!history.length ? <p className="staff-muted">{historyLoading ? "Loading database scan history…" : "No ticket verification attempts have been recorded yet."}</p> : <div className="staff-history-list">{history.map((item) => <div className="staff-history-row" key={item.id}><span className={`staff-history-status ${item.result === "ACCEPTED" ? "accepted" : "rejected"}`}>{item.result}</span><span className="staff-history-message">{item.message}</span><span className="staff-history-code">{item.ticket_code || (item.ticket_id ? `Ticket #${item.ticket_id}` : "QR scan")}</span><time>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</time></div>)}</div>}
      </section>
      <footer className="staff-footer"><span>EventX · Smart Event Ticketing</span><span>Verification is enforced by the server</span></footer>
    </main>
  );
}
