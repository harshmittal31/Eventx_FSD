import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import StaffDashboard from "./StaffDashboard";
import { Html5QrcodeScanner } from "html5-qrcode";

const API_BASE = "http://localhost:5000/api";

const SECTION_INFO = {
  VIP: { label: "VIP", color: "vip", description: "Premium experience" },
  PREMIUM: { label: "Premium", color: "premium", description: "Enhanced seating" },
  REGULAR: { label: "Regular", color: "regular", description: "Standard seating" },
};

function getNotificationStorageKey(user) {
  const identity = user?.id ?? user?.userId ?? user?.email ?? "anonymous";
  return `eventx_read_notifications_${String(identity).toLowerCase()}`;
}

function getNotificationKey(notification) {
  if (notification?.id !== undefined && notification?.id !== null) {
    return String(notification.id);
  }
  return `${notification?.created_at || ""}|${notification?.title || ""}|${notification?.message || ""}`;
}

function App() {
  const [eventId, setEventId] = useState("2");
  const [seats, setSeats] = useState([]);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [lockedSeats, setLockedSeats] = useState([]);

  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const [authMode, setAuthMode] = useState("login");
  const [showAuth, setShowAuth] = useState(false);
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("eventx_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() =>
    localStorage.getItem("jwt_token")
  );

  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [myBookings, setMyBookings] = useState([]);
  const [myTickets, setMyTickets] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", email: "" });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "", newPassword: "", confirmPassword: ""
  });
  const [eventNotifications, setEventNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const identity = (() => {
        const saved = localStorage.getItem("eventx_user");
        return saved ? JSON.parse(saved) : null;
      })();
      const stored = localStorage.getItem(getNotificationStorageKey(identity));
      return new Set(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set();
    }
  });

  // Verify Ticket page and scanner state.
  const [showVerifyTicket, setShowVerifyTicket] = useState(false);
  const [manualQrData, setManualQrData] = useState("");
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [verificationError, setVerificationError] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const scannerContainerRef = useRef(null);

  const previousEventId = useRef(eventId);

  // Event discovery state.
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("upcoming");
  const [showCreateEvent, setShowCreateEvent] = useState(false);
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

  // Customer extras: wishlist, waitlist, reviews, support and test checkout.
  const [showWishlist, setShowWishlist] = useState(false);
  const [wishlist, setWishlist] = useState([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [myWaitlist, setMyWaitlist] = useState([]);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [supportRequests, setSupportRequests] = useState([]);
  const [supportForm, setSupportForm] = useState({ subject: "", message: "", bookingId: "" });
  const [supportMessage, setSupportMessage] = useState("");
  const [supportError, setSupportError] = useState("");
  const [supportLoading, setSupportLoading] = useState(false);
  const [detailEvent, setDetailEvent] = useState(null);
  const [eventReviews, setEventReviews] = useState([]);
  const [reviewSummary, setReviewSummary] = useState({ review_count: 0, average_rating: 0 });
  const [reviewForm, setReviewForm] = useState({ rating: "5", review: "" });
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("ALL");

  // Fetch published events for the discovery section.
  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError("");

    try {
      const response = await fetch(`${API_BASE}/events`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Unable to load events.");
      }

      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setEventsError(err.message || "Unable to load events.");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const normalizedRole = String(user?.role || "").toUpperCase();
  const notificationStorageKey = getNotificationStorageKey(user);
  const canManageEvents = normalizedRole === "ADMIN" || normalizedRole === "STAFF";
  const unreadNotificationCount = eventNotifications.reduce((count, notification) => {
    return count + (readNotificationIds.has(getNotificationKey(notification)) ? 0 : 1);
  }, 0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(notificationStorageKey);
      setReadNotificationIds(new Set(stored ? JSON.parse(stored) : []));
    } catch {
      setReadNotificationIds(new Set());
    }
  }, [notificationStorageKey]);

  const markNotificationsAsRead = useCallback(async (notifications = eventNotifications) => {
    const nextReadIds = new Set(readNotificationIds);
    notifications.forEach((notification) => nextReadIds.add(getNotificationKey(notification)));
    setReadNotificationIds(nextReadIds);
    try {
      localStorage.setItem(notificationStorageKey, JSON.stringify([...nextReadIds]));
    } catch (storageError) {
      console.warn("Could not persist read notification state locally.", storageError);
    }

    if (!token || normalizedRole !== "CUSTOMER" || notifications.length === 0) return;
    try {
      const response = await fetch(`${API_BASE}/notifications/read-all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Could not mark notifications as read.");
      }
      setEventNotifications((current) => current.map((notification) => ({ ...notification, is_read: true })));
    } catch (error) {
      console.error("Could not persist notification read state on server:", error);
      setNotificationsError(error.message || "Could not update notification read status.");
    }
  }, [eventNotifications, notificationStorageKey, readNotificationIds, token, normalizedRole]);

  // Opening the notifications page marks the notifications currently displayed as read.
  useEffect(() => {
    if (
      showNotifications &&
      normalizedRole === "CUSTOMER" &&
      !notificationsLoading &&
      eventNotifications.some((notification) => !readNotificationIds.has(getNotificationKey(notification)))
    ) {
      markNotificationsAsRead(eventNotifications);
    }
  }, [showNotifications, normalizedRole, notificationsLoading, eventNotifications, readNotificationIds, markNotificationsAsRead]);

  // Staff and admins must use the dedicated dashboard, never the customer booking panel.
  useEffect(() => {
    if (token && canManageEvents && window.location.pathname !== "/staff") {
      window.location.replace("/staff");
    }
  }, [token, canManageEvents]);

  const filteredEvents = events.filter((event) => {
    const query = eventSearch.trim().toLowerCase();
    const searchable = `${event.name || ""} ${event.venue_name || ""} ${event.description || ""}`.toLowerCase();
    const eventTime = new Date(event.event_date).getTime();
    const isUpcoming = Number.isFinite(eventTime) && eventTime >= Date.now();
    const matchesSearch = !query || searchable.includes(query);
    const matchesFilter =
      eventFilter === "all" ||
      (eventFilter === "upcoming" && isUpcoming) ||
      (eventFilter === "past" && !isUpcoming);
    return matchesSearch && matchesFilter;
  });

  const chooseEvent = (event) => {
    setEventId(String(event.id));
    setShowMyBookings(false);
    setShowNotifications(false);
    setShowVerifyTicket(false);
    setError("");
    setMessage("");
    window.setTimeout(() => {
      document.getElementById("booking-area")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  // Fetch seats for the selected event.
  const fetchSeats = useCallback(async () => {
    if (!eventId || !/^\d+$/.test(eventId) || Number(eventId) < 1) {
      setError("Enter a valid event ID.");
      setSeats([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/events/${eventId}/seats`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load seats.");
      }

      setSeats(data.seats || []);
      setMessage("");
    } catch (err) {
      setError(
        `${err.message} Check that your backend is running on port 5000.`
      );
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (previousEventId.current !== eventId) {
      previousEventId.current = eventId;
      setSelectedSeats([]);
      setLockedSeats([]);
      setConfirmedBooking(null);
      setMessage("");
      setError("");
    }

    fetchSeats();
  }, [eventId, fetchSeats]);

  // Fetch booking history from the database so it survives page refreshes.
  const fetchMyBookings = useCallback(async () => {
    if (!token) {
      setMyBookings([]);
      setMyTickets([]);
      setBookingsError("");
      return;
    }

    setBookingsLoading(true);
    setBookingsError("");
    try {
      const response = await fetch(`${API_BASE}/bookings/my-bookings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        throw new Error("Your session may have expired. Please log in again.");
      }
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Could not load your booking history.");
      }

      setMyBookings(Array.isArray(data.bookings) ? data.bookings : []);

      // Fetch QR images from the existing ticket endpoint for frontend display.
      const ticketResponse = await fetch(`${API_BASE}/tickets/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ticketData = await ticketResponse.json().catch(() => ({}));
      if (!ticketResponse.ok || ticketData.success === false) {
        throw new Error(ticketData.message || "Bookings loaded, but ticket QR codes could not be loaded.");
      }
      setMyTickets(Array.isArray(ticketData.tickets) ? ticketData.tickets : []);
    } catch (err) {
      setBookingsError(err.message || "Could not load your booking history.");
    } finally {
      setBookingsLoading(false);
    }
  }, [token]);


  const customerRequest = async (path, options = {}) => {
    if (!token) throw new Error("Please log in to use this feature.");
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.message || `Request failed (${response.status}).`);
    }
    return data;
  };

  const fetchWishlist = async () => {
    setWishlistLoading(true);
    try {
      const data = await customerRequest("/customer/wishlist");
      setWishlist(Array.isArray(data.wishlist) ? data.wishlist : []);
    } catch (err) {
      setError(err.message || "Unable to load wishlist.");
    } finally {
      setWishlistLoading(false);
    }
  };

  const toggleWishlist = async (eventItem) => {
    if (!token || normalizedRole !== "CUSTOMER") {
      setShowAuth(true);
      setAuthMode("login");
      setAuthError("Log in with a customer account to save events.");
      return;
    }
    const isSaved = wishlist.some((item) => String(item.event_id) === String(eventItem.id));
    try {
      await customerRequest(`/customer/wishlist/${eventItem.id}`, {
        method: isSaved ? "DELETE" : "POST",
      });
      if (isSaved) setWishlist((items) => items.filter((item) => String(item.event_id) !== String(eventItem.id)));
      else setWishlist((items) => [...items, { event_id: eventItem.id, ...eventItem }]);
      setMessage(isSaved ? "Event removed from your wishlist." : "Event saved to your wishlist.");
    } catch (err) {
      setError(err.message || "Unable to update wishlist.");
    }
  };

  const fetchWaitlist = async () => {
    setWaitlistLoading(true);
    try {
      const data = await customerRequest("/waitlist/my");
      setMyWaitlist(Array.isArray(data.waitlist) ? data.waitlist : []);
    } catch (err) {
      setError(err.message || "Unable to load your waitlist.");
    } finally {
      setWaitlistLoading(false);
    }
  };

  const joinWaitlist = async (eventItem) => {
    if (!token || normalizedRole !== "CUSTOMER") {
      setShowAuth(true);
      setAuthMode("login");
      setAuthError("Log in with a customer account to join the waitlist.");
      return;
    }
    try {
      const data = await customerRequest(`/waitlist/${eventItem.id}`, { method: "POST", body: JSON.stringify({}) });
      setMessage(data.message || "Joined the event waitlist.");
      await fetchWaitlist();
      setShowWaitlist(true);
    } catch (err) {
      setError(err.message || "Unable to join the waitlist.");
    }
  };

  const loadEventDetails = async (eventItem) => {
    setDetailEvent(eventItem);
    setReviewError("");
    setReviewMessage("");
    setEventReviews([]);
    setReviewSummary({ review_count: 0, average_rating: 0 });
    try {
      const response = await fetch(`${API_BASE}/customer/events/${eventItem.id}/reviews`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setEventReviews(Array.isArray(data.reviews) ? data.reviews : []);
        setReviewSummary(data.summary || { review_count: 0, average_rating: 0 });
      }
    } catch (err) {
      console.warn("Could not load event reviews:", err);
    }
  };

  const submitEventReview = async (event) => {
    event.preventDefault();
    if (!detailEvent) return;
    setReviewLoading(true);
    setReviewError("");
    setReviewMessage("");
    try {
      const data = await customerRequest(`/customer/events/${detailEvent.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating: Number(reviewForm.rating), review: reviewForm.review.trim() }),
      });
      setReviewMessage(data.message || "Review saved.");
      setReviewForm({ rating: "5", review: "" });
      await loadEventDetails(detailEvent);
    } catch (err) {
      setReviewError(err.message || "Unable to save review.");
    } finally {
      setReviewLoading(false);
    }
  };

  const fetchSupportRequests = async () => {
    try {
      const data = await customerRequest("/customer/support/my");
      setSupportRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (err) {
      setSupportError(err.message || "Unable to load support requests.");
    }
  };

  const submitSupportRequest = async (event) => {
    event.preventDefault();
    setSupportLoading(true);
    setSupportError("");
    setSupportMessage("");
    try {
      const data = await customerRequest("/customer/support", {
        method: "POST",
        body: JSON.stringify({
          subject: supportForm.subject.trim(),
          message: supportForm.message.trim(),
          bookingId: supportForm.bookingId || null,
        }),
      });
      setSupportMessage(`${data.message || "Support request submitted."}${data.requestId ? ` Reference #${data.requestId}.` : ""}`);
      setSupportForm({ subject: "", message: "", bookingId: "" });
      await fetchSupportRequests();
    } catch (err) {
      setSupportError(err.message || "Unable to submit support request.");
    } finally {
      setSupportLoading(false);
    }
  };

  // Customer profile is read and updated on the server.
  const fetchProfile = useCallback(async () => {
    if (!token) return;
    setProfileLoading(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || "Could not load your profile.");
      }
      const profile = data.user || data.profile || {};
      setProfileForm({ name: profile.name || "", email: profile.email || "" });
      const nextUser = { ...(user || {}), ...profile };
      setUser(nextUser);
      localStorage.setItem("eventx_user", JSON.stringify(nextUser));
    } catch (err) {
      setProfileError(err.message || "Could not load your profile.");
    } finally {
      setProfileLoading(false);
    }
  }, [token, user]);

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: profileForm.name.trim(),
          email: profileForm.email.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || "Could not update your profile.");
      }
      const updatedUser = data.user || { ...user, ...profileForm };
      setUser(updatedUser);
      localStorage.setItem("eventx_user", JSON.stringify(updatedUser));
      setProfileForm({ name: updatedUser.name || "", email: updatedUser.email || "" });
      setProfileMessage("Profile updated successfully.");
    } catch (err) {
      setProfileError(err.message || "Could not update your profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setProfileError("");
    setProfileMessage("");
    if (passwordForm.newPassword.length < 8) {
      setProfileError("New password must be at least 8 characters.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setProfileError("New password and confirmation do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetch(`${API_BASE}/auth/change-password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || "Could not change password.");
      }
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setProfileMessage("Password changed successfully. Please keep it secure.");
    } catch (err) {
      setProfileError(err.message || "Could not change password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const fetchEventNotifications = useCallback(async () => {
    if (!token || normalizedRole !== "CUSTOMER") {
      setEventNotifications([]);
      return;
    }

    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const response = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Could not load event notifications.");
      }
      setEventNotifications(Array.isArray(data.notifications) ? data.notifications : []);
    } catch (err) {
      setNotificationsError(err.message || "Could not load event notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [token, normalizedRole]);

  useEffect(() => {
    if (token) fetchMyBookings();
    else {
      setMyBookings([]);
      setMyTickets([]);
    }
  }, [token, fetchMyBookings]);

  useEffect(() => {
    if (token && normalizedRole === "CUSTOMER") fetchEventNotifications();
    else setEventNotifications([]);
  }, [token, normalizedRole, fetchEventNotifications]);

  // Verify a scanned or manually entered signed QR payload.
  const verifyTicketQr = useCallback(async (rawQrData) => {
    if (!token) {
      setVerificationError("Please log in before verifying a ticket.");
      setShowAuth(true);
      setAuthMode("login");
      return;
    }

    const qrData = String(rawQrData || "").trim();
    if (!qrData) {
      setVerificationError("Scan a QR code or paste its QR data first.");
      return;
    }

    setVerificationLoading(true);
    setVerificationError("");
    setVerificationResult(null);

    try {
      const response = await fetch(`${API_BASE}/tickets/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ qrData }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        throw new Error("Your session may have expired. Please log in again.");
      }

      // Show the server's rejection details too, so invalid/used tickets are clear.
      setVerificationResult({
        success: response.ok && data.success === true,
        message: data.message || (response.ok ? "Verification response received." : "Ticket verification failed."),
        ticket: data.ticket || data.data?.ticket || null,
        data,
      });

      if (!response.ok || data.success === false) {
        setVerificationError(data.message || "Ticket verification failed.");
      }
    } catch (err) {
      setVerificationError(err.message || "Could not verify the ticket.");
    } finally {
      setVerificationLoading(false);
    }
  }, [token]);

  // Start/stop the camera scanner only while the Verify Ticket page is open.
  useEffect(() => {
    if (!showVerifyTicket || !scannerActive || !scannerContainerRef.current) {
      return undefined;
    }

    let scanner;
    let disposed = false;

    try {
      scanner = new Html5QrcodeScanner(
        "eventx-qr-reader",
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          rememberLastUsedCamera: true,
          aspectRatio: 1,
        },
        false
      );

      scanner.render(
        (decodedText) => {
          if (disposed) return;
          setManualQrData(decodedText);
          setScannerActive(false);
          // Stop scanner first; verification proceeds using the decoded payload.
          Promise.resolve(scanner.clear()).catch(() => {});
          verifyTicketQr(decodedText);
        },
        () => {
          // Ignore transient camera/QR decode errors while the user is scanning.
        }
      );
    } catch (err) {
      setVerificationError(err.message || "Could not start the QR scanner.");
    }

    return () => {
      disposed = true;
      if (scanner) {
        Promise.resolve(scanner.clear()).catch(() => {});
      }
    };
  }, [showVerifyTicket, scannerActive, verifyTicketQr]);

  // Create an event using the existing backend endpoint. STAFF and ADMIN are authorized server-side.
  const handleCreateEvent = async (event) => {
    event.preventDefault();
    if (!token || !canManageEvents) {
      setCreateEventError("Only logged-in STAFF or ADMIN accounts can create events.");
      return;
    }

    setCreatingEvent(true);
    setCreateEventError("");
    setCreateEventMessage("");

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
      if (response.status === 401 || response.status === 403) {
        throw new Error(data.message || "Your account is not authorized to create events.");
      }
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || "Event creation failed.");
      }

      setCreateEventMessage(`Event created successfully (ID ${data.eventId}). ${data.totalSeats || 0} seats generated.`);
      setEventForm({ name: "", description: "", venueName: "", eventDate: "", rows: 10, seatsPerRow: 10 });
      setEventFilter("all");
      await fetchEvents();
      if (data.eventId) {
        setEventId(String(data.eventId));
        setShowCreateEvent(false);
        window.setTimeout(() => document.getElementById("booking-area")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }
    } catch (err) {
      setCreateEventError(err.message || "Could not create event.");
    } finally {
      setCreatingEvent(false);
    }
  };

  // Login and registration.
  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    setAuthLoading(true);
    setAuthError("");
    setError("");
    setMessage("");

    const isRegister = authMode === "register";
    const endpoint = isRegister ? "register" : "login";

    const payload = isRegister
      ? authForm
      : {
          email: authForm.email,
          password: authForm.password,
        };

    try {
      const response = await fetch(
        `${API_BASE}/auth/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            `${isRegister ? "Registration" : "Login"} failed.`
        );
      }

      if (isRegister) {
        setAuthMode("login");
        setAuthForm((current) => ({
          ...current,
          password: "",
        }));
        setMessage("Account created successfully. Please log in.");
      } else {
        if (!data.token) {
          throw new Error(
            "Login succeeded but the server did not return a token."
          );
        }

        localStorage.setItem("jwt_token", data.token);
        localStorage.setItem(
          "eventx_user",
          JSON.stringify(data.user)
        );

        setToken(data.token);
        setUser(data.user);
        setShowAuth(false);
        setAuthForm({ name: "", email: "", password: "" });

        const loggedInRole = String(data.user?.role || "CUSTOMER").toUpperCase();
        if (loggedInRole === "STAFF" || loggedInRole === "ADMIN") {
          window.location.replace("/staff");
          return;
        }

        window.location.replace("/");
      }
    } catch (err) {
      setAuthError(err.message || "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout.
  const logout = () => {
    localStorage.removeItem("jwt_token");
    localStorage.removeItem("eventx_user");

    setToken(null);
    setUser(null);
    setLockedSeats([]);
    setSelectedSeats([]);
    setConfirmedBooking(null);
    setMyBookings([]);
    setShowMyBookings(false);
    setShowNotifications(false);
    setShowProfile(false);
    setShowWishlist(false);
    setShowWaitlist(false);
    setShowSupport(false);
    setShowCheckout(false);
    setDetailEvent(null);
    setShowAuth(false);
    setAuthError("");
    setError("");
    setMessage("You have been logged out.");
  };

  // Select or deselect an available seat.
  const toggleSeat = (seat) => {
    if (seat.status !== "AVAILABLE") return;

    setError("");
    setMessage("");

    setSelectedSeats((current) =>
      current.some((item) => item.id === seat.id)
        ? current.filter((item) => item.id !== seat.id)
        : [...current, seat]
    );
  };

  const totalPrice = selectedSeats.reduce(
    (total, seat) => total + Number(seat.price || 0),
    0
  );

  // Lock selected seats using the existing backend endpoint.
  const lockSelectedSeats = async () => {
    if (!token) {
      setShowAuth(true);
      setAuthMode("login");
      setError("Please log in to lock your selected seats.");
      return;
    }

    if (selectedSeats.length === 0) {
      setError("Select at least one available seat.");
      return;
    }

    setLocking(true);
    setError("");
    setMessage("");
    setConfirmedBooking(null);

    const successfulLocks = [];
    const failedLocks = [];

    try {
      for (const seat of selectedSeats) {
        try {
          const response = await fetch(
            `${API_BASE}/events/${eventId}/seats/${seat.id}/lock`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );

          const result = await response.json();

          if (response.status === 401 || response.status === 403) {
            throw new Error(
              "Your session may have expired. Please log in again."
            );
          }

          if (!response.ok || result.success === false) {
            throw new Error(result.message || "Could not lock seat.");
          }

          // The backend returns the lock UUID in result.lock.id.
          const lockId =
            result.lock?.id ??
            result.lockId ??
            result.seatLock?.lockId ??
            result.data?.lock?.id ??
            result.data?.lockId ??
            null;

          if (!lockId) {
            throw new Error(
              "The server did not return a lock ID. Refresh the seat map before proceeding."
            );
          }

          successfulLocks.push({
            seat,
            lockId,
            expiresAt: result.lock?.expiresAt ?? null,
          });
        } catch (err) {
          failedLocks.push({
            seat,
            reason: err.message,
          });
        }
      }

      if (
        failedLocks.some(({ reason }) =>
          reason.includes("session may have expired")
        )
      ) {
        logout();
        setShowAuth(true);
        setAuthMode("login");
        setError(
          "Your session may have expired. Please log in again."
        );
        return;
      }

      if (successfulLocks.length > 0) {
        setLockedSeats((current) => {
          const existingIds = new Set(
            current.map((seat) => seat.id)
          );

          const newlyLocked = successfulLocks
            .filter(({ seat }) => !existingIds.has(seat.id))
            .map(({ seat, lockId, expiresAt }) => ({
              ...seat,
              status: "HELD",
              lockId,
              expiresAt,
            }));

          return [...current, ...newlyLocked];
        });

        setSeats((current) =>
          current.map((seat) =>
            successfulLocks.some(
              (locked) => locked.seat.id === seat.id
            )
              ? { ...seat, status: "HELD" }
              : seat
          )
        );
      }

      setSelectedSeats((current) =>
        current.filter(
          (seat) =>
            !successfulLocks.some(
              (locked) => locked.seat.id === seat.id
            )
        )
      );

      // Refresh backend seat availability without clearing lock IDs.
      try {
        const response = await fetch(
          `${API_BASE}/events/${eventId}/seats`
        );

        const data = await response.json();

        if (response.ok && data.success) {
          setSeats(data.seats || []);
        }
      } catch (err) {
        console.error("Could not refresh seats:", err);
      }

      if (failedLocks.length === 0 && successfulLocks.length > 0) {
        setMessage(
          `Successfully locked ${successfulLocks.length} seat(s).`
        );
      } else if (successfulLocks.length > 0) {
        setMessage(
          `${successfulLocks.length} seat(s) locked; ${failedLocks.length} could not be locked.`
        );

        setError(
          failedLocks
            .map(
              ({ seat, reason }) =>
                `${seat.seat_number}: ${reason}`
            )
            .join(" ")
        );
      } else {
        setError(
          failedLocks
            .map(
              ({ seat, reason }) =>
                `${seat.seat_number}: ${reason}`
            )
            .join(" ") || "No seats could be locked."
        );
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLocking(false);
    }
  };

  // Checkout is explicitly a test-mode simulation; no real payment is collected.
  const confirmBooking = () => {
    if (!token) {
      setShowAuth(true);
      setAuthMode("login");
      setError("Please log in before checkout.");
      return;
    }
    if (!lockedSeats.length || lockedSeats.some((seat) => !seat.lockId)) {
      setError("Lock your selected seats again before checkout.");
      return;
    }
    setCheckoutError("");
    setCheckoutMessage("");
    setShowCheckout(true);
  };

  // Finalize the existing booking only after the customer selects test-mode success.
  const processTestCheckout = async () => {
    if (!token) {
      setShowAuth(true);
      setAuthMode("login");
      setError("Please log in before confirming your booking.");
      return;
    }

    if (lockedSeats.length === 0) {
      setError("Lock at least one available seat before confirming your booking.");
      return;
    }

    const missingLock = lockedSeats.find((seat) => !seat.lockId);
    if (missingLock) {
      setError(
        `The lock ID for seat ${missingLock.seat_number} is missing. Lock that seat again.`
      );
      return;
    }

    setBookingLoading(true);
    setError("");
    setMessage("");
    setConfirmedBooking(null);

    try {
      const response = await fetch(`${API_BASE}/bookings/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lockIds: lockedSeats.map((seat) => seat.lockId),
        }),
      });

      const data = await response.json();

      if (response.status === 401 || response.status === 403) {
        logout();
        setShowAuth(true);
        setAuthMode("login");
        throw new Error(
          response.status === 401
            ? "Your session has expired. Please log in and try again."
            : data.message || "You are not allowed to confirm these seat locks."
        );
      }

      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Booking confirmation failed.");
      }

      const bookedSeats =
        Array.isArray(data.booking?.seats) && data.booking.seats.length > 0
          ? data.booking.seats
          : lockedSeats.map((seat) => ({
              seatId: seat.id,
              seatNumber: seat.seat_number,
              section: seat.section,
              price: Number(seat.price || 0),
            }));

      const totalAmount =
        data.booking?.totalAmount != null
          ? Number(data.booking.totalAmount)
          : bookedSeats.reduce(
              (total, seat) => total + Number(seat.price || 0),
              0
            );

      setConfirmedBooking({
        ...data,
        seats: bookedSeats,
        totalAmount,
        seatNumber: bookedSeats.map((seat) => seat.seatNumber).join(", "),
        seatPrice: totalAmount,
      });

      const confirmedSeatIds = new Set(
        lockedSeats.map((seat) => seat.id)
      );

      // All submitted locks were consumed by the booking transaction.
      setLockedSeats((current) =>
        current.filter((seat) => !confirmedSeatIds.has(seat.id))
      );

      setSelectedSeats((current) =>
        current.filter((seat) => !confirmedSeatIds.has(seat.id))
      );

      setSeats((current) =>
        current.map((seat) =>
          confirmedSeatIds.has(seat.id)
            ? { ...seat, status: "BOOKED" }
            : seat
        )
      );

      setMessage(
        `TEST MODE: booking confirmed for ${bookedSeats.length} seat(s). No real payment was collected.`
      );
      setShowCheckout(false);
      setCheckoutMessage("Test payment simulated successfully. No money was charged.");

      // Reload database-backed booking history after confirmation.
      await fetchMyBookings();

      // Refresh persisted seat statuses from the backend.
      try {
        const refreshResponse = await fetch(
          `${API_BASE}/events/${eventId}/seats`
        );
        const refreshData = await refreshResponse.json();

        if (refreshResponse.ok && refreshData.success) {
          setSeats(refreshData.seats || []);
        }
      } catch (err) {
        console.error(
          "Booking succeeded, but seats could not be refreshed:",
          err
        );
      }
    } catch (err) {
      setError(err.message || "Unable to confirm the booking.");
    } finally {
      setBookingLoading(false);
    }
  };

  // Cancel a booking selected from either the confirmation panel or booking history.
  const cancelBookingById = async (bookingId) => {
    if (!token || !bookingId) {
      setError("Booking ID or login session is missing. Please log in again.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to cancel this booking? All seats in this booking will be released."
    );
    if (!confirmed) return;

    setCancellingBooking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/bookings/${bookingId}/cancel`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        logout();
        setShowAuth(true);
        setAuthMode("login");
        throw new Error("Your session has expired. Please log in again.");
      }
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Could not cancel this booking.");
      }

      setConfirmedBooking((current) =>
        current?.booking?.id === bookingId
          ? {
              ...current,
              booking: { ...(current.booking || {}), status: "CANCELLED" },
              status: "CANCELLED",
              cancellation: data,
            }
          : current
      );

      setMessage("Booking cancelled successfully.");
      await Promise.all([fetchMyBookings(), fetchSeats()]);
    } catch (err) {
      setError(err.message || "Unable to cancel booking.");
    } finally {
      setCancellingBooking(false);
    }
  };

  const cancelCurrentBooking = () =>
    cancelBookingById(confirmedBooking?.booking?.id);

  // Seat map helpers.
  const sections = ["VIP", "PREMIUM", "REGULAR"];

  const getSeatClass = (seat) => {
    if (lockedSeats.some((item) => item.id === seat.id)) {
      return "seat seat-locked-by-me";
    }

    if (
      selectedSeats.some((item) => item.id === seat.id) &&
      seat.status === "AVAILABLE"
    ) {
      return "seat seat-selected";
    }

    if (seat.status === "BOOKED") return "seat seat-booked";
    if (seat.status === "HELD") return "seat seat-held";

    return "seat seat-available";
  };

  const groupedSeats = seats.reduce((groups, seat) => {
    const row =
      seat.row_label || seat.seat_number?.charAt(0) || "?";

    if (!groups[row]) groups[row] = [];
    groups[row].push(seat);

    return groups;
  }, {});

  if (window.location.pathname === "/staff") {
    return <StaffDashboard />;
  }

  return (
    <main className="eventx-app">
      <header className="app-header">
        <a className="brand" href="#top">
          <span className="brand-icon">E</span>
          <span>
            <strong>EventX</strong>
            <small>SMART EVENT TICKETING</small>
          </span>
        </a>

        <div className="header-right">
          {user ? (
            <div className="user-actions">
              <span className="welcome-user">
                Hi, {user.name}
              </span>
              {normalizedRole === "CUSTOMER" && (
                <button
                  className="refresh-button"
                  type="button"
                  onClick={() => {
                    const opening = !showProfile;
                    setShowProfile(opening);
                    if (opening) {
                      setShowMyBookings(false);
                      setShowNotifications(false);
                      setShowWishlist(false);
                      setShowWaitlist(false);
                      setShowSupport(false);
                      fetchProfile();
                    }
                  }}
                  aria-expanded={showProfile}
                >
                  {showProfile ? "Hide Profile" : "My Profile"}
                </button>
              )}
              {normalizedRole === "CUSTOMER" && (
                <button
                  className="refresh-button"
                  type="button"
                  onClick={() => {
                    const opening = !showMyBookings;
                    setShowMyBookings(opening);
                    if (opening) {
                      setShowNotifications(false);
                      setShowProfile(false);
                      setShowWishlist(false);
                      setShowWaitlist(false);
                      setShowSupport(false);
                    }
                    setError("");
                    if (opening) fetchMyBookings();
                  }}
                >
                  {showMyBookings ? "Hide My Bookings" : "My Bookings"}
                </button>
              )}
              {normalizedRole === "CUSTOMER" && (
                <button
                  className={`refresh-button notification-nav-button ${showNotifications ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    const opening = !showNotifications;
                    setShowNotifications(opening);
                    if (opening) {
                      setShowMyBookings(false);
                      setShowProfile(false);
                      setShowWishlist(false);
                      setShowWaitlist(false);
                      setShowSupport(false);
                      fetchEventNotifications();
                    }
                  }}
                  aria-expanded={showNotifications}
                  aria-controls="event-notifications-page"
                >
                  Notifications
                  {unreadNotificationCount > 0 && (
                    <span className="notification-count" aria-label={`${unreadNotificationCount} unread notifications`}>
                      {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                    </span>
                  )}
                </button>
              )}
              {normalizedRole === "CUSTOMER" && (
                <button className="refresh-button" type="button" onClick={() => {
                  setShowMyBookings(false); setShowNotifications(false); setShowProfile(false);
                  setShowWishlist((v) => !v); setShowWaitlist(false); setShowSupport(false);
                  if (!showWishlist) fetchWishlist();
                }}>{showWishlist ? "Hide Wishlist" : `Wishlist${wishlist.length ? ` (${wishlist.length})` : ""}`}</button>
              )}
              {normalizedRole === "CUSTOMER" && (
                <button className="refresh-button" type="button" onClick={() => {
                  setShowMyBookings(false); setShowNotifications(false); setShowProfile(false); setShowWishlist(false); setShowSupport(false);
                  setShowWaitlist((v) => !v); if (!showWaitlist) fetchWaitlist();
                }}>{showWaitlist ? "Hide Waitlist" : "My Waitlist"}</button>
              )}
              {normalizedRole === "CUSTOMER" && (
                <button className="refresh-button" type="button" onClick={() => {
                  setShowMyBookings(false); setShowNotifications(false); setShowProfile(false); setShowWishlist(false); setShowWaitlist(false);
                  setShowSupport((v) => !v); setSupportError(""); if (!showSupport) fetchSupportRequests();
                }}>{showSupport ? "Hide Support" : "Support"}</button>
              )}
              {canManageEvents && (
                <button
                  className="refresh-button"
                  type="button"
                  onClick={() => {
                    setShowMyBookings(false);
                    setShowNotifications(false);
                    setShowVerifyTicket(false);
                    setShowCreateEvent((current) => !current);
                    setCreateEventError("");
                    setCreateEventMessage("");
                    window.setTimeout(() => document.getElementById("create-event-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                  }}
                >
                  {showCreateEvent ? "Hide Create Event" : "Create Event"}
                </button>
              )}
              {canManageEvents && (
              <button
                className="refresh-button"
                type="button"
                onClick={() => {
                  setShowMyBookings(false);
                  setShowNotifications(false);
                  setShowVerifyTicket((current) => !current);
                  setVerificationError("");
                  setVerificationResult(null);
                  setScannerActive(false);
                }}
              >
                {showVerifyTicket ? "Hide Verify Ticket" : "Verify Ticket"}
              </button>
              )}
              <button
                className="refresh-button"
                type="button"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          ) : (
            <button
              className="refresh-button auth-header-button"
              type="button"
              onClick={() => {
                setAuthMode("login");
                setShowAuth(true);
                setAuthError("");
                setError("");
                setMessage("");
              }}
            >
              Log in / Register
            </button>
          )}

          <span className="secure-label">● Secure booking</span>
        </div>
      </header>

      {detailEvent && (
        <div
          className="event-detail-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-details-modal-heading"
          onClick={(e) => { if (e.target === e.currentTarget) setDetailEvent(null); }}
        >
          <section className="event-detail-modal">
            <div className="event-detail-modal-header">
              <div className="event-detail-modal-badge">EVENT DETAILS</div>
              <button
                className="event-detail-modal-close"
                type="button"
                aria-label="Close event details"
                onClick={() => setDetailEvent(null)}
              >×</button>
            </div>

            <div className="event-detail-modal-art">
              <span className="event-detail-art-mark">E</span>
              <span className="event-detail-art-id">EVENT #{detailEvent.id}</span>
            </div>

            <h2 id="event-details-modal-heading" className="event-detail-modal-title">{detailEvent.name}</h2>
            <p className="event-detail-modal-meta">
              <span>📍 {detailEvent.venue_name}</span>
              <span>🕐 {detailEvent.event_date ? new Date(detailEvent.event_date).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Date to be announced"}</span>
            </p>

            <p className="event-detail-modal-desc">{detailEvent.description || "Join this experience and reserve your seat."}</p>

            <div className="event-detail-modal-stats">
              <div className="event-detail-stat">
                <small>Status</small>
                <strong className={`event-status-pill status-${String(detailEvent.status || "PUBLISHED").toLowerCase()}`}>{detailEvent.status || "PUBLISHED"}</strong>
              </div>
              <div className="event-detail-stat">
                <small>Total seats</small>
                <strong>{detailEvent.total_seats ?? "—"}</strong>
              </div>
              <div className="event-detail-stat">
                <small>Avg. rating</small>
                <strong>{Number(reviewSummary.average_rating || 0).toFixed(1)} ★ ({reviewSummary.review_count || 0} reviews)</strong>
              </div>
            </div>

            {normalizedRole === "CUSTOMER" && (
              <div className="event-detail-modal-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={String(detailEvent.status || "PUBLISHED").toUpperCase() !== "PUBLISHED" || new Date(detailEvent.event_date).getTime() < Date.now()}
                  onClick={() => { chooseEvent(detailEvent); setDetailEvent(null); }}
                >
                  Choose seats
                </button>
                <button className="refresh-button" type="button" onClick={() => toggleWishlist(detailEvent)}>
                  {wishlist.some((item) => String(item.event_id) === String(detailEvent.id)) ? "♥ Remove from wishlist" : "♡ Add to wishlist"}
                </button>
                <button className="refresh-button" type="button" onClick={() => joinWaitlist(detailEvent)}>Join waitlist</button>
              </div>
            )}

            <div className="event-detail-modal-reviews">
              <h3>Reviews & ratings</h3>
              {eventReviews.length === 0 ? (
                <p className="empty-selection">No reviews yet. Eligible customers can leave the first review after the event.</p>
              ) : (
                <div className="event-detail-reviews-list">
                  {eventReviews.map((review) => (
                    <article className="customer-review-card" key={review.id}>
                      <strong>{review.customer_name || "Customer"} · {"★".repeat(Number(review.rating))}</strong>
                      <p>{review.review || "Rating only"}</p>
                      <small>{new Date(review.created_at).toLocaleDateString()}</small>
                    </article>
                  ))}
                </div>
              )}
              {token && normalizedRole === "CUSTOMER" && (
                <form className="feature-form event-detail-review-form" onSubmit={submitEventReview}>
                  <h4>Leave a review</h4>
                  <label>Rating
                    <select value={reviewForm.rating} onChange={(e) => setReviewForm((v) => ({ ...v, rating: e.target.value }))}>
                      {[5,4,3,2,1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}
                    </select>
                  </label>
                  <label>Your review (optional)
                    <textarea maxLength={2000} rows={3} value={reviewForm.review} onChange={(e) => setReviewForm((v) => ({ ...v, review: e.target.value }))} placeholder="Share your experience after attending the event" />
                  </label>
                  {reviewError && <div className="inline-error">{reviewError}</div>}
                  {reviewMessage && <div className="success-message">{reviewMessage}</div>}
                  <button className="primary-button" type="submit" disabled={reviewLoading}>{reviewLoading ? "Saving…" : "Submit / update review"}</button>
                  <small>Reviews are accepted only after the event for customers with a confirmed booking.</small>
                </form>
              )}
            </div>
          </section>
        </div>
      )}

      {showWishlist && normalizedRole === "CUSTOMER" && (
        <section className="customer-feature-panel">
          <div className="panel-heading"><div><p className="eyebrow">SAVED EVENTS</p><h2>My Wishlist</h2><p className="intro-description">Events you want to revisit.</p></div><button className="refresh-button" type="button" onClick={fetchWishlist} disabled={wishlistLoading}>Refresh</button></div>
          {wishlistLoading ? <p className="state-message">Loading wishlist…</p> : wishlist.length === 0 ? <p className="state-message">Your wishlist is empty. Use Save event on any event card.</p> : <div className="feature-list">{wishlist.map((item) => <article className="feature-list-item" key={item.event_id}><div><strong>{item.name}</strong><p>{item.venue_name} · {item.event_date ? new Date(item.event_date).toLocaleString("en-IN") : ""}</p><small>{item.status}</small></div><div className="customer-feature-actions"><button className="refresh-button" type="button" onClick={() => loadEventDetails({ ...item, id: item.event_id })}>Details</button><button className="primary-button" type="button" onClick={() => toggleWishlist({ ...item, id: item.event_id })}>Remove</button></div></article>)}</div>}
        </section>
      )}

      {showWaitlist && normalizedRole === "CUSTOMER" && (
        <section className="customer-feature-panel">
          <div className="panel-heading"><div><p className="eyebrow">SOLD-OUT EVENT UPDATES</p><h2>My Waitlist</h2><p className="intro-description">Track waitlist status and position. Offers do not automatically book seats.</p></div><button className="refresh-button" type="button" onClick={fetchWaitlist} disabled={waitlistLoading}>Refresh</button></div>
          {waitlistLoading ? <p className="state-message">Loading waitlist…</p> : myWaitlist.length === 0 ? <p className="state-message">You haven't joined any waitlists yet.</p> : <div className="feature-list">{myWaitlist.map((item) => <article className="feature-list-item" key={item.id}><div><strong>{item.event_name || item.name || `Event #${item.event_id}`}</strong><p>Position: {item.position ?? "—"} · Status: {item.status}</p><small>{item.event_date ? new Date(item.event_date).toLocaleString("en-IN") : ""}</small></div><div className="customer-feature-actions"><button className="refresh-button" type="button" onClick={() => { const e = events.find((ev) => String(ev.id) === String(item.event_id)); if (e) loadEventDetails(e); }}>View event</button>{["WAITING", "NOTIFIED"].includes(String(item.status).toUpperCase()) && <button className="danger-button" type="button" onClick={async () => { try { await customerRequest(`/waitlist/${item.event_id}`, { method: "DELETE" }); await fetchWaitlist(); } catch (err) { setError(err.message); } }}>Leave waitlist</button>}</div></article>)}</div>}
        </section>
      )}

      {showSupport && normalizedRole === "CUSTOMER" && (
        <section className="customer-feature-panel">
          <div className="panel-heading"><div><p className="eyebrow">WE ARE HERE TO HELP</p><h2>Customer Support</h2><p className="intro-description">Raise a booking, ticket or refund query and track its status.</p></div><button className="refresh-button" type="button" onClick={fetchSupportRequests}>Refresh requests</button></div>
          <form className="feature-form" onSubmit={submitSupportRequest}>
            <label>Related booking (optional)<select value={supportForm.bookingId} onChange={(e) => setSupportForm((v) => ({ ...v, bookingId: e.target.value }))}><option value="">Not related to a specific booking</option>{myBookings.map((b) => <option key={b.id} value={b.id}>{b.bookingReference || `Booking #${b.id}`} — {b.eventName || `Event #${b.eventId}`}</option>)}</select></label>
            <label>Subject<input required minLength={3} maxLength={160} value={supportForm.subject} onChange={(e) => setSupportForm((v) => ({ ...v, subject: e.target.value }))} placeholder="e.g. Refund status query" /></label>
            <label>Message<textarea required minLength={10} maxLength={4000} rows={4} value={supportForm.message} onChange={(e) => setSupportForm((v) => ({ ...v, message: e.target.value }))} placeholder="Describe how we can help…" /></label>
            {supportError && <div className="inline-error">{supportError}</div>}{supportMessage && <div className="success-message">{supportMessage}</div>}
            <button className="primary-button" type="submit" disabled={supportLoading}>{supportLoading ? "Submitting…" : "Submit support request"}</button>
          </form>
          <h3>Your support requests</h3>
          {supportRequests.length === 0 ? <p className="empty-selection">No support requests yet.</p> : <div className="feature-list">{supportRequests.map((r) => <article className="feature-list-item" key={r.id}><div><strong>#{r.id} · {r.subject}</strong><p>{r.message}</p>{r.admin_response && <p><b>Response:</b> {r.admin_response}</p>}</div><span className="booking-status-badge">{r.status}</span></article>)}</div>}
        </section>
      )}

      {showCheckout && normalizedRole === "CUSTOMER" && (
        <div className="checkout-overlay" role="dialog" aria-modal="true" aria-labelledby="checkout-heading">
          <section className="checkout-dialog">
            <p className="eyebrow">TEST MODE ONLY</p><h2 id="checkout-heading">Checkout summary</h2>
            <p>No real payment provider is connected. Choosing success below only confirms the existing booking flow for development/testing.</p>
            <div className="feature-summary-grid"><div><small>Event</small><strong>{events.find((e) => String(e.id) === String(eventId))?.name || `Event #${eventId}`}</strong></div><div><small>Locked seats</small><strong>{lockedSeats.map((x) => x.seat_number).join(", ")}</strong></div><div><small>Total (simulated)</small><strong>₹{lockedSeats.reduce((sum, x) => sum + Number(x.price || 0), 0).toLocaleString("en-IN")}</strong></div></div>
            {checkoutError && <div className="inline-error">{checkoutError}</div>}{checkoutMessage && <div className="success-message">{checkoutMessage}</div>}
            <div className="customer-feature-actions"><button className="primary-button" type="button" disabled={bookingLoading} onClick={async () => { setCheckoutError(""); setCheckoutMessage(""); await processTestCheckout(); }}>{bookingLoading ? "Processing test…" : "Simulate success (no charge)"}</button><button className="danger-button" type="button" onClick={() => { setCheckoutError("Test payment failed. No booking was confirmed. You can retry."); setCheckoutMessage(""); }}>Simulate failure</button><button className="refresh-button" type="button" onClick={() => setShowCheckout(false)}>Back to seats</button></div>
          </section>
        </div>
      )}

      {showProfile && normalizedRole === "CUSTOMER" && (
        <section className="profile-panel" aria-labelledby="profile-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">YOUR EVENTX ACCOUNT</p>
              <h2 id="profile-heading">My Profile</h2>
              <p className="intro-description">Update your account details or change your password.</p>
            </div>
            <button className="refresh-button" type="button" onClick={fetchProfile} disabled={profileLoading}>
              {profileLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {profileError && <div className="inline-error" role="alert">{profileError}</div>}
          {profileMessage && <div className="success-message" role="status">{profileMessage}</div>}
          {profileLoading ? <p className="state-message">Loading profile…</p> : (
            <div className="profile-grid">
              <form className="profile-form" onSubmit={saveProfile}>
                <h3>Account details</h3>
                <label>
                  Full name
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    value={profileForm.name}
                    onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Email address
                  <input
                    type="email"
                    required
                    maxLength={255}
                    value={profileForm.email}
                    onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))}
                    autoComplete="email"
                  />
                </label>
                <button className="primary-button" type="submit" disabled={profileSaving}>
                  {profileSaving ? "Saving…" : "Save profile"}
                </button>
              </form>
              <form className="profile-form" onSubmit={changePassword}>
                <h3>Change password</h3>
                <label>
                  Current password
                  <input type="password" required value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    autoComplete="current-password" />
                </label>
                <label>
                  New password
                  <input type="password" required minLength={8} value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                    autoComplete="new-password" />
                </label>
                <label>
                  Confirm new password
                  <input type="password" required minLength={8} value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    autoComplete="new-password" />
                </label>
                <button className="primary-button" type="submit" disabled={passwordSaving}>
                  {passwordSaving ? "Updating…" : "Change password"}
                </button>
              </form>
            </div>
          )}
        </section>
      )}

      {showNotifications && normalizedRole === "CUSTOMER" && (
        <section className="notifications-page-panel" id="event-notifications-page" aria-labelledby="event-notifications-heading">
          <div className="panel-heading notifications-page-heading">
            <div>
              <p className="eyebrow">YOUR EVENTX INBOX</p>
              <h2 id="event-notifications-heading">Notifications</h2>
              <p className="intro-description">Event changes and refund updates, kept separate from your booking history.</p>
            </div>
            <div className="my-bookings-actions">
              <span className={`notification-read-summary ${unreadNotificationCount ? "has-unread" : "all-read"}`}>
                {unreadNotificationCount ? `${unreadNotificationCount} unread` : "All caught up"}
              </span>
              {unreadNotificationCount > 0 && (
                <button className="refresh-button" type="button" onClick={() => markNotificationsAsRead(eventNotifications)}>
                  Mark all as read
                </button>
              )}
              <button className="refresh-button" type="button" onClick={fetchEventNotifications} disabled={notificationsLoading}>
                {notificationsLoading ? "Refreshing…" : "Refresh notifications"}
              </button>
              <button className="refresh-button" type="button" onClick={() => setShowNotifications(false)}>
                Close
              </button>
            </div>
          </div>
          {notificationsError && <div className="inline-error" role="alert">{notificationsError}</div>}
          {notificationsLoading && eventNotifications.length === 0 ? (
            <p className="notification-empty">Loading event updates…</p>
          ) : notificationsError ? null : eventNotifications.length === 0 ? (
            <div className="notifications-empty-state">
              <span className="notifications-empty-icon">✓</span>
              <strong>You’re all caught up</strong>
              <p>No event notifications right now.</p>
            </div>
          ) : (
            <div className="event-notifications-list">
              {eventNotifications.map((notification) => {
                const notificationIsRead = readNotificationIds.has(getNotificationKey(notification));
                return (
                  <article
                    className={`event-notification-card ${String(notification.type || "").toLowerCase()} ${notificationIsRead ? "is-read" : "is-unread"}`}
                    key={getNotificationKey(notification)}
                  >
                    <div className="event-notification-icon">!</div>
                    <div className="event-notification-content">
                      <div className="notification-title-row">
                        <strong>{notification.title || "Event update"}</strong>
                        {!notificationIsRead && <span className="notification-unread-pill">Unread</span>}
                      </div>
                      <p>{notification.message}</p>
                      <small>{notification.created_at ? new Date(notification.created_at).toLocaleString() : ""}</small>
                    </div>
                    {notification.refund_status && (
                      <span className="refund-status-pill">Refund: {String(notification.refund_status).replaceAll("_", " ")}</span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showMyBookings && (
        <section className="my-bookings-panel" aria-labelledby="my-bookings-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">YOUR EVENTX ACCOUNT</p>
              <h2 id="my-bookings-heading">My Bookings</h2>
              <p className="intro-description">
                Your booking history is loaded from the server and remains available after refresh.
              </p>
            </div>
            <div className="my-bookings-actions">
              <button
                className="refresh-button"
                type="button"
                onClick={fetchMyBookings}
                disabled={bookingsLoading}
              >
                {bookingsLoading ? "Refreshing…" : "Refresh bookings"}
              </button>
              <button
                className="refresh-button"
                type="button"
                onClick={() => setShowMyBookings(false)}
              >
                Close
              </button>
            </div>
          </div>

          {bookingsLoading && myBookings.length === 0 && (
            <div className="state-message">Loading your bookings…</div>
          )}

          {bookingsError && (
            <div className="inline-error" role="alert">{bookingsError}</div>
          )}

          {!bookingsLoading && !bookingsError && myBookings.length === 0 && (
            <div className="state-message">
              No bookings found for this account yet.
            </div>
          )}

          {myBookings.length > 0 && (
            <div className="booking-filter-toolbar">
              <input type="search" value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} placeholder="Search booking reference or event…" aria-label="Search bookings" />
              <select value={bookingStatusFilter} onChange={(e) => setBookingStatusFilter(e.target.value)} aria-label="Filter booking status">
                {["ALL", "CONFIRMED", "CANCELLED", "COMPLETED"].map((status) => <option key={status} value={status}>{status === "ALL" ? "All statuses" : status}</option>)}
              </select>
            </div>
          )}
          {myBookings.filter((b) => {
            const status = String(b.status || "CONFIRMED").toUpperCase();
            const q = bookingSearch.trim().toLowerCase();
            const text = `${b.bookingReference || ""} ${b.eventName || ""} ${b.id || ""}`.toLowerCase();
            return (!q || text.includes(q)) && (bookingStatusFilter === "ALL" || status === bookingStatusFilter);
          }).map((booking) => {
            const bookingStatus = String(booking.status || "CONFIRMED").toUpperCase();
            const bookingSeats = Array.isArray(booking.seats) ? booking.seats : [];
            const bookingTickets = Array.isArray(booking.tickets) ? booking.tickets : [];

            return (
              <article className="my-booking-card" key={booking.id}>
                <div className="my-booking-card-header">
                  <div>
                    <p className="eyebrow">BOOKING REFERENCE</p>
                    <h3>{booking.bookingReference || `Booking #${booking.id}`}</h3>
                    {booking.eventName && <p className="booking-event-name">{booking.eventName}</p>}
                  </div>
                  <span className={`booking-status-badge ${bookingStatus.toLowerCase()}`}>
                    {bookingStatus}
                  </span>
                </div>

                <div className="my-booking-details">
                  <div className="confirmation-detail">
                    <span>Event ID</span>
                    <strong>{booking.eventId ?? "—"}</strong>
                  </div>
                  <div className="confirmation-detail">
                    <span>Seats</span>
                    <strong>
                      {bookingSeats.map((seat) => seat.seatNumber || seat.seat_number).filter(Boolean).join(", ") || "—"}
                    </strong>
                  </div>
                  <div className="confirmation-detail">
                    <span>Number of seats</span>
                    <strong>{booking.seatCount ?? bookingSeats.length}</strong>
                  </div>
                  <div className="confirmation-detail">
                    <span>Total amount</span>
                    <strong>₹{Number(booking.totalAmount || 0).toLocaleString("en-IN")}</strong>
                  </div>
                  <div className="confirmation-detail">
                    <span>Booking ID</span>
                    <strong>{booking.id}</strong>
                  </div>
                </div>

                {String(booking.eventStatus || "").toUpperCase() === "CANCELLED" && (
                  <div className="event-cancelled-alert" role="status">
                    <strong>Event cancelled by the organizer</strong>
                    <p>This event will not take place as scheduled. Your booking record is preserved. Refund status: {booking.refundStatus ? String(booking.refundStatus).replaceAll("_", " ") : "PENDING REVIEW"}. No refund has been issued automatically.</p>
                  </div>
                )}

                <div className="my-booking-tickets">
                  <h4>Tickets</h4>
                  {bookingTickets.length > 0 ? (
                    bookingTickets.map((ticket) => {
                      const ticketId = ticket.id ?? ticket.ticketId;
                      const ticketCode = ticket.ticketCode ?? ticket.ticket_code;
                      const qrTicket = myTickets.find((item) =>
                        String(item.id) === String(ticketId) ||
                        (ticketCode && String(item.ticket_code) === String(ticketCode))
                      );
                      const seatName = ticket.seatNumber ?? ticket.seat_number ?? qrTicket?.seat_number;
                      return (
                        <div className="booking-ticket-card" key={ticketId ?? ticketCode}>
                          <div className="confirmation-detail">
                            <span>{seatName ? `Seat ${seatName}` : `Ticket ${ticketId ?? ""}`}</span>
                            <strong>{ticketCode || "Ticket code unavailable"}{(ticket.status ?? qrTicket?.status) ? ` · ${ticket.status ?? qrTicket?.status}` : ""}</strong>
                          </div>
                          {qrTicket?.qr_code ? (
                            <div className="ticket-qr-wrap">
                              <img
                                className="ticket-qr-image"
                                src={qrTicket.qr_code}
                                alt={`QR code for ticket ${ticketCode || ticketId}`}
                                width="180"
                                height="180"
                              />
                              <span>Show this QR code at entry</span>
                              <div className="customer-feature-actions">
                                <a className="refresh-button" href={qrTicket.qr_code} download={`EventX-${ticketCode || ticketId}.png`}>Download QR</a>
                                <button className="refresh-button" type="button" onClick={() => window.print()}>Print ticket</button>
                              </div>
                            </div>
                          ) : (
                            <p className="ticket-qr-pending">QR code is not available for this ticket.</p>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="empty-selection">No ticket details were returned for this booking.</p>
                  )}
                </div>

                {bookingStatus !== "CANCELLED" && bookingStatus !== "CANCELED" ? (
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => cancelBookingById(booking.id)}
                    disabled={cancellingBooking || !booking.id}
                  >
                    {cancellingBooking ? "Cancelling booking…" : "Cancel Booking"}
                  </button>
                ) : (
                  <p className="cancelled-note">This booking has been cancelled.</p>
                )}
              </article>
            );
          })}
        </section>
      )}

      {showVerifyTicket && (
        <section className="verify-ticket-panel" aria-labelledby="verify-ticket-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EVENTX ENTRY CONTROL</p>
              <h2 id="verify-ticket-heading">Verify Ticket</h2>
              <p className="intro-description">
                Scan the ticket QR code or paste its QR data to check it with the server.
              </p>
            </div>
            <button
              className="refresh-button"
              type="button"
              onClick={() => {
                setScannerActive(false);
                setShowVerifyTicket(false);
                setVerificationResult(null);
                setVerificationError("");
              }}
            >
              Close
            </button>
          </div>

          <div className="verify-ticket-grid">
            <div className="verify-ticket-card">
              <h3>Scan with camera</h3>
              <p>Allow camera access when your browser asks. Use HTTPS or localhost for camera access.</p>
              <div id="eventx-qr-reader" ref={scannerContainerRef} className="qr-reader-container" />
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setVerificationError("");
                  setVerificationResult(null);
                  setScannerActive((current) => !current);
                }}
                disabled={verificationLoading}
              >
                {scannerActive ? "Stop scanner" : "Start QR scanner"}
              </button>
            </div>

            <div className="verify-ticket-card">
              <h3>Manual QR data</h3>
              <p>If you cannot use the camera, paste the raw QR payload. A ticket code alone is not QR data.</p>
              <label className="qr-data-label" htmlFor="manual-qr-data">QR payload</label>
              <textarea
                id="manual-qr-data"
                value={manualQrData}
                onChange={(event) => {
                  setManualQrData(event.target.value);
                  setVerificationError("");
                }}
                placeholder="Paste the complete signed QR data here…"
                rows={5}
                spellCheck={false}
              />
              <button
                className="primary-button"
                type="button"
                onClick={() => verifyTicketQr(manualQrData)}
                disabled={verificationLoading || !manualQrData.trim()}
              >
                {verificationLoading ? "Verifying…" : "Verify ticket"}
              </button>
            </div>
          </div>

          {verificationError && (
            <div className="inline-error verify-feedback" role="alert" aria-live="polite">
              {verificationError}
            </div>
          )}

          {verificationResult && (
            <div
              className={`verification-result ${verificationResult.success ? "verification-valid" : "verification-invalid"}`}
              role="status"
              aria-live="polite"
            >
              <div className="verification-result-heading">
                <span className="verification-result-icon">
                  {verificationResult.success ? "✓" : "×"}
                </span>
                <div>
                  <h3>{verificationResult.success ? "Ticket verified" : "Ticket not verified"}</h3>
                  <p>{verificationResult.message}</p>
                </div>
              </div>
              {verificationResult.ticket && (
                <div className="verification-ticket-details">
                  {[
                    ["Ticket code", verificationResult.ticket.ticket_code ?? verificationResult.ticket.ticketCode],
                    ["Ticket ID", verificationResult.ticket.id ?? verificationResult.ticket.ticketId],
                    ["Event ID", verificationResult.ticket.event_id ?? verificationResult.ticket.eventId],
                    ["Seat", verificationResult.ticket.seat_number ?? verificationResult.ticket.seatNumber],
                    ["Status", verificationResult.ticket.status],
                  ].filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => (
                    <div className="confirmation-detail" key={label}>
                      <span>{label}</span><strong>{String(value)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {showAuth && (
        <section className="auth-panel" aria-labelledby="auth-heading">
          <div className="auth-panel-heading">
            <div>
              <p className="eyebrow">YOUR EVENTX ACCOUNT</p>
              <h2 id="auth-heading">
                {authMode === "login"
                  ? "Welcome back"
                  : "Create an account"}
              </h2>
              <p className="auth-description">
                {authMode === "login"
                  ? "Log in to lock your selected seats."
                  : "Register to get started with EventX."}
              </p>
            </div>

            <button
              className="auth-close"
              type="button"
              aria-label="Close authentication panel"
              onClick={() => setShowAuth(false)}
            >
              ×
            </button>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "register" && (
              <label>
                Full name
                <input
                  type="text"
                  autoComplete="name"
                  required
                  value={authForm.name}
                  onChange={(e) =>
                    setAuthForm((current) => ({
                      ...current,
                      name: e.target.value,
                    }))
                  }
                  placeholder="Your name"
                />
              </label>
            )}

            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={authForm.email}
                onChange={(e) =>
                  setAuthForm((current) => ({
                    ...current,
                    email: e.target.value,
                  }))
                }
                placeholder="you@example.com"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                autoComplete={
                  authMode === "login"
                    ? "current-password"
                    : "new-password"
                }
                required
                minLength={8}
                value={authForm.password}
                onChange={(e) =>
                  setAuthForm((current) => ({
                    ...current,
                    password: e.target.value,
                  }))
                }
                placeholder="At least 8 characters"
              />
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait…"
                : authMode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>

          {authError && (
            <div
              className="inline-error auth-feedback"
              role="alert"
              aria-live="polite"
            >
              {authError}
            </div>
          )}

          {message && showAuth && (
            <div
              className="success-message auth-feedback"
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
          )}

          <p className="auth-switch">
            {authMode === "login"
              ? "New to EventX?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setAuthMode(
                  authMode === "login" ? "register" : "login"
                );
                setAuthError("");
                setError("");
                setMessage("");
              }}
            >
              {authMode === "login"
                ? "Create an account"
                : "Log in"}
            </button>
          </p>
        </section>
      )}

      {showCreateEvent && canManageEvents && (
        <section className="create-event-panel" id="create-event-panel" aria-labelledby="create-event-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STAFF / ADMIN WORKSPACE</p>
              <h2 id="create-event-heading">Create a new event</h2>
              <p className="intro-description">Publish an event and generate its venue seats automatically.</p>
            </div>
            <button className="refresh-button" type="button" onClick={() => setShowCreateEvent(false)}>Close</button>
          </div>
          <form className="create-event-form" onSubmit={handleCreateEvent}>
            <label>Event name
              <input required maxLength={200} value={eventForm.name} onChange={(e) => setEventForm((current) => ({ ...current, name: e.target.value }))} placeholder="e.g. EventX Music Festival" />
            </label>
            <label>Venue name
              <input required maxLength={200} value={eventForm.venueName} onChange={(e) => setEventForm((current) => ({ ...current, venueName: e.target.value }))} placeholder="e.g. Delhi Arena" />
            </label>
            <label>Event date and time
              <input required type="datetime-local" value={eventForm.eventDate} onChange={(e) => setEventForm((current) => ({ ...current, eventDate: e.target.value }))} />
            </label>
            <label>Rows (1–26)
              <input required type="number" min="1" max="26" value={eventForm.rows} onChange={(e) => setEventForm((current) => ({ ...current, rows: e.target.value }))} />
            </label>
            <label>Seats per row (1–50)
              <input required type="number" min="1" max="50" value={eventForm.seatsPerRow} onChange={(e) => setEventForm((current) => ({ ...current, seatsPerRow: e.target.value }))} />
            </label>
            <label className="create-event-description">Description
              <textarea rows="3" value={eventForm.description} onChange={(e) => setEventForm((current) => ({ ...current, description: e.target.value }))} placeholder="Describe the event for customers" />
            </label>
            <div className="create-event-total">Total seats to generate: <strong>{Math.max(0, Number(eventForm.rows) || 0) * Math.max(0, Number(eventForm.seatsPerRow) || 0)}</strong></div>
            {createEventError && <div className="inline-error" role="alert">{createEventError}</div>}
            {createEventMessage && <div className="success-message" role="status">{createEventMessage}</div>}
            <button className="primary-button create-event-submit" type="submit" disabled={creatingEvent}>
              {creatingEvent ? "Creating event…" : "Create event and generate seats"}
            </button>
          </form>
        </section>
      )}

      <section className="page-intro" id="top">
        <div>
          <p className="eyebrow">
            YOUR NEXT EXPERIENCE STARTS HERE
          </p>
          <h1>Choose your seats.</h1>
          <p className="intro-description">
            Find your perfect spot, select your seats, and get ready for the event.
          </p>
        </div>

        <div className="event-discovery-tools">
          <label htmlFor="event-search">Find an event</label>
          <input
            id="event-search"
            type="search"
            value={eventSearch}
            onChange={(event) => setEventSearch(event.target.value)}
            placeholder="Search event or venue"
          />
          <div className="event-filter-row" role="group" aria-label="Filter events">
            {[
              ["upcoming", "Upcoming"],
              ["all", "All events"],
              ["past", "Past"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`event-filter-button ${eventFilter === value ? "active" : ""}`}
                onClick={() => setEventFilter(value)}
                aria-pressed={eventFilter === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="event-discovery" aria-labelledby="events-heading">
        <div className="event-discovery-heading">
          <div>
            <p className="eyebrow">DISCOVER YOUR NEXT EXPERIENCE</p>
            <h2 id="events-heading">Explore events</h2>
            <p>Choose an event to view its venue map and available seats.</p>
          </div>
          <button
            className="refresh-button"
            type="button"
            onClick={fetchEvents}
            disabled={eventsLoading}
          >
            {eventsLoading ? "Refreshing…" : "Refresh events"}
          </button>
        </div>

        {eventsError && (
          <div className="inline-error" role="alert">
            {eventsError} Make sure the backend is running and GET /api/events is available.
          </div>
        )}

        {eventsLoading && events.length === 0 ? (
          <div className="event-empty-state">Loading published events…</div>
        ) : filteredEvents.length === 0 ? (
          <div className="event-empty-state">
            <strong>No events found</strong>
            <span>Try another search or filter. Only published events appear here.</span>
          </div>
        ) : (
          <div className="event-card-grid">
            {filteredEvents.map((event) => {
              const eventDate = new Date(event.event_date);
              const dateLabel = Number.isNaN(eventDate.getTime())
                ? "Date to be announced"
                : eventDate.toLocaleString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  });
              const selected = String(event.id) === String(eventId);
              return (
                <article
                  className={`event-card ${selected ? "event-card-selected" : ""}`}
                  key={event.id}
                >
                  <div className="event-card-art">
                    <span className="event-card-art-mark">E</span>
                    <span className="event-card-id">EVENT #{event.id}</span>
                  </div>
                  <div className="event-card-content">
                    <div className="event-card-meta">
                      <span className="event-status-pill">
                        {event.status || "PUBLISHED"}
                      </span>
                      {Number.isFinite(eventDate.getTime()) && eventDate.getTime() < Date.now() && (
                        <span className="event-past-label">Past event</span>
                      )}
                    </div>
                    <h3>{event.name}</h3>
                    <p className="event-card-description">
                      {event.description || "Join this experience and reserve your seat."}
                    </p>
                    <div className="event-card-detail">
                      <span aria-hidden="true">◷</span>
                      <span>{dateLabel}</span>
                    </div>
                    <div className="event-card-detail">
                      <span aria-hidden="true">⌖</span>
                      <span>{event.venue_name}</span>
                    </div>
                    <div className="event-card-bottom">
                      <span>{event.total_seats} seats in venue</span>
                      <div className="event-card-actions">
                        <button className="refresh-button" type="button" onClick={() => loadEventDetails(event)}>Details</button>
                        {normalizedRole === "CUSTOMER" && <button className="refresh-button" type="button" onClick={() => toggleWishlist(event)}>{wishlist.some((item) => String(item.event_id) === String(event.id)) ? "♥ Saved" : "♡ Save"}</button>}
                        <button
                          className="event-book-button"
                          type="button"
                          disabled={String(event.status || "PUBLISHED").toUpperCase() !== "PUBLISHED" || new Date(event.event_date).getTime() < Date.now()}
                          onClick={() => chooseEvent(event)}
                        >
                          {selected ? "Selected event" : "Book tickets"}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="selected-event-banner">
        <div>
          <p className="eyebrow">CURRENT SELECTION</p>
          <h2>{events.find((event) => String(event.id) === String(eventId))?.name || `Event #${eventId}`}</h2>
          <p>
            {events.find((event) => String(event.id) === String(eventId))?.venue_name || "Choose an event above"}
            {" · "}
            {(() => {
              const selected = events.find((event) => String(event.id) === String(eventId));
              if (!selected?.event_date) return "Select an event to see its date";
              const date = new Date(selected.event_date);
              return Number.isNaN(date.getTime()) ? "Date to be announced" : date.toLocaleString("en-IN", {
                day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit"
              });
            })()}
          </p>
        </div>
        <span className="selected-event-id">Event ID: {eventId}</span>
      </div>

      <section className="booking-layout" id="booking-area">
        <div className="seat-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INTERACTIVE VENUE MAP</p>
              <h2>Select your seats</h2>
            </div>
            <span className="seat-count">
              {seats.length} total seats
            </span>
          </div>

          <div className="seat-legend">
            <span>
              <i className="legend-dot available-dot" /> Available
            </span>
            <span>
              <i className="legend-dot selected-dot" /> Selected
            </span>
            <span>
              <i className="legend-dot held-dot" /> Held
            </span>
            <span>
              <i className="legend-dot booked-dot" /> Booked
            </span>
          </div>

          <div className="screen-area">
            <div className="screen-shape" />
            <span>STAGE / SCREEN</span>
          </div>

          {loading ? (
            <div className="state-message">Loading venue seats…</div>
          ) : error && seats.length === 0 ? (
            <div className="state-message error-message">
              {error}
            </div>
          ) : seats.length === 0 ? (
            <div className="state-message">
              No seats found for this event.
            </div>
          ) : (
            <div className="seat-map">
              {sections.map((sectionName) => {
                const sectionSeats = seats.filter(
                  (seat) => seat.section === sectionName
                );

                if (sectionSeats.length === 0) return null;

                const info = SECTION_INFO[sectionName];

                return (
                  <section
                    className={`seat-section section-${info.color}`}
                    key={sectionName}
                  >
                    <div className="section-heading">
                      <div>
                        <h3>{info.label}</h3>
                        <p>{info.description}</p>
                      </div>
                      <strong>
                        ₹
                        {Number(
                          sectionSeats[0].price
                        ).toLocaleString("en-IN")}
                      </strong>
                    </div>

                    {Object.entries(groupedSeats)
                      .filter(([, rowSeats]) =>
                        rowSeats.some(
                          (seat) => seat.section === sectionName
                        )
                      )
                      .map(([rowLabel, rowSeats]) => (
                        <div className="seat-row" key={rowLabel}>
                          <span className="row-label">
                            {rowLabel}
                          </span>

                          <div className="row-seats">
                            {rowSeats
                              .filter(
                                (seat) =>
                                  seat.section === sectionName
                              )
                              .sort(
                                (a, b) =>
                                  Number(a.seat_label) -
                                  Number(b.seat_label)
                              )
                              .map((seat) => (
                                <button
                                  key={seat.id}
                                  type="button"
                                  className={`${getSeatClass(
                                    seat
                                  )} ${info.color}`}
                                  title={`${seat.seat_number} · ${seat.status} · ₹${Number(
                                    seat.price
                                  ).toLocaleString("en-IN")}`}
                                  aria-label={`${seat.seat_number}, ${seat.status}, ₹${seat.price}`}
                                  aria-pressed={selectedSeats.some(
                                    (item) => item.id === seat.id
                                  )}
                                  disabled={
                                    seat.status !== "AVAILABLE"
                                  }
                                  onClick={() => toggleSeat(seat)}
                                >
                                  {seat.seat_label}
                                </button>
                              ))}
                          </div>

                          <span className="row-label">
                            {rowLabel}
                          </span>
                        </div>
                      ))}
                  </section>
                );
              })}
            </div>
          )}

          {error && seats.length > 0 && (
            <div
              className="inline-error"
              role="alert"
              aria-live="polite"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              className="success-message"
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
          )}
        </div>

        <aside className="summary-panel">
          <p className="eyebrow">YOUR ORDER</p>
          <h2>Booking summary</h2>

          <div className="summary-stat">
            <span>Selected seats</span>
            <strong>{selectedSeats.length}</strong>
          </div>

          <div className="summary-stat">
            <span>Locked seats</span>
            <strong>{lockedSeats.length}</strong>
          </div>

          <div className="summary-divider" />

          <div className="selected-list">
            <h3>Selected seats</h3>

            {selectedSeats.length === 0 ? (
              <p className="empty-selection">
                Select seats from the venue map to see them here.
              </p>
            ) : (
              selectedSeats.map((seat) => (
                <div className="selected-item" key={seat.id}>
                  <div>
                    <strong>{seat.seat_number}</strong>
                    <small>{seat.section}</small>
                  </div>
                  <span>
                    ₹
                    {Number(seat.price).toLocaleString("en-IN")}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="summary-divider" />

          <div className="total-row">
            <span>Total amount</span>
            <strong>
              ₹{totalPrice.toLocaleString("en-IN")}
            </strong>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={lockSelectedSeats}
            disabled={
              locking ||
              bookingLoading ||
              selectedSeats.length === 0
            }
          >
            {locking
              ? "Locking seats…"
              : `Lock ${selectedSeats.length || ""} seat${
                  selectedSeats.length === 1 ? "" : "s"
                }`}
          </button>

          <p className="security-note">
            🔒 Seats are temporarily reserved after successful locking.
          </p>

          {lockedSeats.length > 0 && (
            <div className="locked-list">
              <h3>Successfully locked</h3>

              {lockedSeats.map((seat) => (
                <div className="locked-item" key={seat.id}>
                  <span>{seat.seat_number}</span>
                  <span className="locked-badge">HELD</span>
                </div>
              ))}

              <p className="security-note">
                A successful lock does not mean the booking is confirmed.
              </p>

              <button
                className="primary-button confirm-booking-button"
                type="button"
                onClick={confirmBooking}
                disabled={
                  bookingLoading ||
                  locking ||
                  lockedSeats.length === 0 ||
                  lockedSeats.some((seat) => !seat.lockId)
                }
              >
                {bookingLoading
                  ? "Confirming booking…"
                  : "Confirm Booking"}
              </button>

              {lockedSeats.length > 1 && (
                <p className="security-note">
                  {lockedSeats.length} seats will be confirmed together in one booking.
                </p>
              )}
            </div>
          )}

          {confirmedBooking && (
            <div
              className="booking-confirmation"
              role="status"
              aria-live="polite"
            >
              <h3>Booking Confirmed ✓</h3>

              <div className="confirmation-detail">
                <span>Seats</span>
                <strong>
                  {Array.isArray(confirmedBooking.seats)
                    ? confirmedBooking.seats
                        .map((seat) => seat.seatNumber)
                        .join(", ")
                    : confirmedBooking.seatNumber}
                </strong>
              </div>

              <div className="confirmation-detail">
                <span>Number of seats</span>
                <strong>
                  {confirmedBooking.booking?.seatCount ??
                    confirmedBooking.seats?.length ??
                    1}
                </strong>
              </div>

              <div className="confirmation-detail">
                <span>Total amount</span>
                <strong>
                  ₹{Number(
                    confirmedBooking.totalAmount ??
                      confirmedBooking.booking?.totalAmount ??
                      confirmedBooking.seatPrice ??
                      0
                  ).toLocaleString("en-IN")}
                </strong>
              </div>

              {confirmedBooking.booking?.bookingReference && (
                <div className="confirmation-detail">
                  <span>Booking reference</span>
                  <strong>{confirmedBooking.booking.bookingReference}</strong>
                </div>
              )}

              {confirmedBooking.booking?.id != null && (
                <div className="confirmation-detail">
                  <span>Booking ID</span>
                  <strong>{confirmedBooking.booking.id}</strong>
                </div>
              )}

              {Array.isArray(confirmedBooking.tickets) && (
                <div className="confirmation-tickets">
                  <h4>Tickets ({confirmedBooking.tickets.length})</h4>
                  {confirmedBooking.tickets.map((ticket) => (
                    <div
                      className="confirmation-detail"
                      key={ticket.ticketId ?? ticket.ticketCode}
                    >
                      <span>
                        {ticket.seatNumber
                          ? `Seat ${ticket.seatNumber}`
                          : `Ticket ${ticket.ticketId}`}
                      </span>
                      <strong>{ticket.ticketCode}</strong>
                    </div>
                  ))}
                </div>
              )}

              <p>Your booking has been confirmed successfully.</p>
            </div>
          )}
        </aside>
      </section>

      <footer className="app-footer">
        <span>EventX © 2026</span>
        <span>Smart ticketing · Secure seat selection</span>
      </footer>
    </main>
  );
}

export default App;