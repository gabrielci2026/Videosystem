"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createLocalAudioTrack, createLocalScreenTracks, createLocalVideoTrack, Room, RoomEvent, Track, type LocalVideoTrack } from "livekit-client";

type User = { id: string; email: string; displayName: string; role?: "USER" | "ADMIN" | "GUEST" };
type Message = { id: string; subject: string; body: string; createdAt: string; sender: { displayName: string; email: string } };
type ChatEntry = { from: string; text: string };
type GuestInvitation = { email: string; roomName: string; organizerName: string; title: string; accepted: boolean };

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState("inicio");
  const [notice, setNotice] = useState("");
  const [messageRecipientId, setMessageRecipientId] = useState<string>();
  const [inviteToken, setInviteToken] = useState<string>();
  const [guestInvitation, setGuestInvitation] = useState<GuestInvitation>();
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  
  useEffect(() => {
    const emailVerified = new URLSearchParams(window.location.search).get("emailVerified");
    if (emailVerified === "success") setNotice("Email confirmado correctamente. Un administrador debe habilitar tu cuenta.");
    if (emailVerified === "error") setNotice("El enlace de confirmación es inválido o expiró.");
    const initAuth = async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        }
      } catch { }
    };
    
    initAuth();
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite") ?? undefined;
    setInviteToken(token);
    if (!token) return;
    setInvitationLoading(true);
    fetch(`/api/invitations/resolve?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const result = await readJsonResponse(response, "No se pudo validar la invitación.");
        if (!response.ok) throw new Error(result.error ?? "La invitación no es válida.");
        setGuestInvitation(result as GuestInvitation);
      })
      .catch((error) => setInvitationError(error instanceof Error ? error.message : "La invitación no es válida."))
      .finally(() => setInvitationLoading(false));
  }, []);
  
  const invitationRoom = guestInvitation?.roomName ?? new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("room") ?? undefined;
  const logout = () => {
    setUser(null);
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  };

  if (invitationLoading) return <main className="auth"><div className="auth-card"><h1>Validando invitación</h1><p className="muted">Espera un momento…</p></div></main>;
  if (invitationError) return <main className="auth"><div className="auth-card"><h1>Invitación no disponible</h1><p className="form-error">{invitationError}</p></div></main>;
  if (!user) return <Auth key={inviteToken ?? invitationRoom ?? "default"} onLogin={setUser} roomName={invitationRoom} inviteToken={inviteToken} invitedEmail={guestInvitation?.email} invitationAccepted={guestInvitation?.accepted} />;
  if (user.role === "GUEST" && !invitationRoom) return <main className="auth"><div className="auth-card"><h1>Acceso solo por invitación</h1><p className="muted">Abre el enlace de la llamada que recibiste para ingresar.</p><button className="primary" onClick={logout}>Cerrar sesión</button></div></main>;
  if (user.role === "GUEST") return <main className="guest-call"><Rooms setNotice={setNotice} guestMode lockedRoom={invitationRoom} />{notice && <div className="notice">{notice}</div>}<button className="logout" onClick={logout}>Cerrar sesión</button></main>;
  return <main className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">V</span><span>VideoSystem</span></div><div className="profile"><div className="avatar">{initials(user.displayName)}</div><div><strong>{user.displayName}</strong><small>{user.role === "ADMIN" ? "Administrador" : user.email}</small></div><span className="status-dot" /></div><nav><p className="nav-label">Workspace</p><Nav active={view === "inicio"} onClick={() => setView("inicio")} icon="⌂">Inicio</Nav><Nav active={view === "mensajes"} onClick={() => setView("mensajes")} icon="✉">Mensajes</Nav><Nav active={view === "salas"} onClick={() => setView("salas")} icon="◉">Salas</Nav><Nav active={view === "contactos"} onClick={() => setView("contactos")} icon="＋">Contactos</Nav>{user.role === "ADMIN" && <><p className="nav-label separated">Administración</p><Nav active={view === "aprobaciones"} onClick={() => setView("aprobaciones")} icon="✓">Aprobaciones</Nav><Nav active={view === "auditoria"} onClick={() => setView("auditoria")} icon="▤">Auditoría</Nav></>}</nav><button className="logout" onClick={logout}>Cerrar sesión</button></aside><section className="content"><header className="topbar"><div><span className="eyebrow">VideoSystem / Espacio privado</span><h1>{view === "inicio" ? "Buen día, tu equipo está aquí." : title(view)}</h1></div><div className="top-avatar">{initials(user.displayName)}</div></header>{notice && <div className={`notice ${notice.startsWith("Error:") ? "notice-error" : notice.startsWith("Advertencia:") ? "notice-warning" : "notice-success"}`} role="status">{notice}</div>}{view === "inicio" && <HomeView setView={setView} />}{view === "mensajes" && <MessagesView setNotice={setNotice} selectedRecipientId={messageRecipientId} />}{view === "salas" && <Rooms setNotice={setNotice} />}{view === "contactos" && <ContactsView onMessage={(id) => { setMessageRecipientId(id); setView("mensajes"); }} />}{view === "aprobaciones" && <ApprovalsView setNotice={setNotice} />}{view === "auditoria" && <AuditLog />}</section></main>;
}

function AuditLog() {
  const [events, setEvents] = useState<Array<{ id: string; action: string; createdAt: string; actor?: { displayName: string; email: string } | null }>>([]);
  useEffect(() => { fetch("/api/admin/audit").then((response) => response.ok && response.json()).then((result) => result && setEvents(result)); }, []);
  return <section className="panel"><div className="panel-head"><h3>Auditoría</h3><span className="count">{events.length}</span></div>{events.length ? events.map((event) => <div className="message" key={event.id}><div><strong>{event.action}</strong><p>{event.actor?.displayName ?? "Sistema"} · {new Date(event.createdAt).toLocaleString("es-AR")}</p></div></div>) : <p className="muted">No hay eventos administrativos.</p>}</section>;
}

function Auth({ onLogin, roomName, inviteToken, invitedEmail, invitationAccepted = false }: { onLogin: (user: User) => void; roomName?: string; inviteToken?: string; invitedEmail?: string; invitationAccepted?: boolean }) {
  const [register, setRegister] = useState(Boolean(inviteToken) && !invitationAccepted);
  const [resetToken, setResetToken] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [emailAction, setEmailAction] = useState<"reset" | "verify" | null>(null);

  useEffect(() => {
    setResetToken(new URLSearchParams(window.location.search).get("reset") ?? "");
  }, []);

  const validatePassword = (pwd: string): string[] => {
    const errors: string[] = [];
    if (pwd.length < 8) errors.push("Mínimo 8 caracteres");
    if (!/[0-9]/.test(pwd)) errors.push("Al menos un número");
    if (!/[A-Z]/.test(pwd)) errors.push("Al menos una mayúscula");
    if (!/[a-z]/.test(pwd)) errors.push("Al menos una minúscula");
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) errors.push("Al menos un símbolo");
    return errors;
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    if (register) setPasswordErrors(validatePassword(value));
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (roomName) data.roomName = roomName;
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) return setError(result.error ?? `Error (${response.status})`);
      setUserId(result.userId);
      setOtpStep(true);
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
  };

  const handleOtpSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: data.otp, ...(roomName ? { roomName } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) return setError(result.error ?? `Error (${response.status})`);
      
      // Después de verificar OTP, obtener el usuario actual desde la sesión
      const userResponse = await fetch("/api/auth/me");
      if (userResponse.ok) {
        const userData = await userResponse.json();
        onLogin(userData);
        setOtpStep(false);
      } else {
        setError("No se pudo obtener los datos del usuario.");
      }
    } catch {
      setError("Error verificando el código.");
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (inviteToken) data.inviteToken = inviteToken;
    const pwd = data.password as string;
    const errors = validatePassword(pwd);
    if (errors.length > 0) {
      setError("Contraseña débil: " + errors.join(", "));
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) return setError(result.error ?? `Error (${response.status})`);
      setError("Solicitud creada. Revisa el email para confirmarlo; después un administrador debe habilitar tu cuenta.");
      setRegister(false);
      setPassword("");
      setPasswordErrors([]);
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
  };

  const handlePasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken, password: formData.get("password") }) });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "No se pudo cambiar la contraseña.");
    setResetToken("");
    window.history.replaceState({}, "", window.location.pathname);
    setError("Contraseña actualizada. Ya puedes iniciar sesión.");
  };

  const requestPasswordReset = async () => {
    setEmailAction("reset");
    setError("");
  };

  const resendVerification = async () => {
    setEmailAction("verify");
    setError("");
  };

  const submitEmailAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("actionEmail") ?? "");
    const endpoint = emailAction === "reset" ? "/api/auth/request-password-reset" : "/api/auth/resend-verification";
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await readJsonResponse(response, "No se pudo procesar la solicitud.");
      if (!response.ok) { setError(result.error ?? "No se pudo procesar la solicitud."); return; }
      setError(result.message ?? "Revisa tu email.");
      setEmailAction(null);
    } catch { setError("No se pudo conectar con el servidor."); }
  };

  if (resetToken) return <main className="auth"><div className="auth-card"><div className="brand"><span className="brand-mark">V</span><span>VideoSystem</span></div><span className="eyebrow">Recuperación de acceso</span><h1>Nueva contraseña</h1><form onSubmit={handlePasswordReset}><input name="password" type="password" placeholder="Nueva contraseña" required minLength={8} /><button className="primary" type="submit">Guardar contraseña</button></form>{error && <p className="form-error">{error}</p>}</div></main>;

  if (otpStep) {
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="brand">
            <span className="brand-mark">V</span>
            <span>VideoSystem</span>
          </div>
          <span className="eyebrow">Verificación de seguridad</span>
          <h1>Ingresa tu código</h1>
          <p className="muted" style={{ marginBottom: "16px" }}>
            Hemos enviado un código de 8 caracteres a tu email. Ingrésalo aquí.
          </p>
          <form onSubmit={handleOtpSubmit}>
            <input
              name="otp"
              placeholder="Código de verificación (8 caracteres)"
              required
              minLength={8}
              maxLength={8}
              autoComplete="off"
              style={{ fontFamily: "monospace", textTransform: "uppercase" }}
            />
            <button className="primary" type="submit">
              Verificar código
            </button>
          </form>
          {error && <p className="form-error">{error}</p>}
          <button className="link-button" onClick={() => { setOtpStep(false); setError(""); setPassword(""); }}>
            Volver al login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>VideoSystem</span>
        </div>
        <span className="eyebrow">{inviteToken ? "Invitación personal a videollamada" : "Comunicación propia y privada"}</span>
        <h1>{register ? (inviteToken ? "Regístrate como invitado" : "Solicita tu acceso") : (inviteToken ? "Ingresa a la llamada" : "Entra a tu workspace")}</h1>
        <form onSubmit={register ? handleRegister : handleLogin}>
          {register && (
            <input
              name="displayName"
              placeholder="Nombre completo"
              required
              minLength={2}
            />
          )}
          <input name="email" type="email" placeholder="Email corporativo" required defaultValue={invitedEmail} readOnly={Boolean(inviteToken && invitedEmail)} />
          <input
            name="password"
            type="password"
            placeholder="Contraseña"
            required
            minLength={register ? 8 : 1}
            value={password}
            onChange={handlePasswordChange}
          />
          {register && passwordErrors.length > 0 && (
            <div className="password-requirements">
              <p style={{ fontSize: "11px", color: "#999", marginBottom: "8px" }}>Requisitos:</p>
              {passwordErrors.map((err, i) => (
                <p key={i} style={{ fontSize: "11px", color: "#e74c3c", margin: "4px 0" }}>
                  ✗ {err}
                </p>
              ))}
            </div>
          )}
          {register && passwordErrors.length === 0 && password.length > 0 && (
            <div className="password-requirements">
              <p style={{ fontSize: "11px", color: "#27ae60", margin: "4px 0" }}>
                ✓ Contraseña válida
              </p>
            </div>
          )}
          <button
            className="primary"
            type="submit"
            disabled={register && passwordErrors.length > 0}
          >
            {register ? "Enviar solicitud" : "Iniciar sesión"}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
        {emailAction && <form className="compose" onSubmit={submitEmailAction}><label htmlFor="action-email">Email de tu cuenta</label><input id="action-email" name="actionEmail" type="email" autoComplete="email" required /><button className="primary" type="submit">{emailAction === "reset" ? "Enviar recuperación" : "Reenviar verificación"}</button><button className="link-button" type="button" onClick={() => setEmailAction(null)}>Cancelar</button></form>}
        {!register && <button className="link-button" onClick={requestPasswordReset}>¿Olvidaste tu contraseña?</button>}
        {!register && <button className="link-button" onClick={resendVerification}>Reenviar email de verificación</button>}
        <button
          className="link-button"
          onClick={() => {
            setRegister(!register);
            setError("");
            setPassword("");
            setPasswordErrors([]);
          }}
        >
          {register ? "Ya tengo una cuenta" : "Solicitar una cuenta nueva"}
        </button>
      </div>
    </main>
  );
}


function HomeView({ setView }: { setView: (view: string) => void }) { return <><div className="quick-grid"><button className="quick coral-bg" onClick={() => setView("salas")}><span>＋</span><strong>Nueva sala</strong><small>Iniciar una videollamada</small></button><button className="quick blue-bg" onClick={() => setView("mensajes")}><span>✎</span><strong>Nuevo mensaje</strong><small>Escribir a un contacto</small></button><button className="quick yellow-bg" onClick={() => setView("salas")}><span>⌁</span><strong>Unirse a sala</strong><small>Usar código de reunión</small></button></div><div className="section-heading"><div><span className="eyebrow">Tu actividad</span><h2>Herramientas de tu equipo</h2></div></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><h3>Mensajería interna</h3><span className="count">Privada</span></div><p className="muted">Envía mensajes a usuarios activos y conserva el control de tus datos.</p><button className="text-button" onClick={() => setView("mensajes")}>Abrir bandeja de entrada →</button></section><section className="panel"><div className="panel-head"><h3>Videollamadas</h3><span className="live-label"><i /> LiveKit</span></div><p className="muted">Salas 1 a 1 o grupales con audio, cámara y compartir pantalla.</p><button className="text-button" onClick={() => setView("salas")}>Abrir salas →</button></section></div></>; }

function Messages({ setNotice }: { setNotice: (value: string) => void }) { const [messages, setMessages] = useState<Message[]>([]); const [users, setUsers] = useState<User[]>([]); const [open, setOpen] = useState(false); const load = async () => { const [messageResponse, usersResponse] = await Promise.all([fetch("/api/messages"), fetch("/api/users")]); if (messageResponse.ok) setMessages(await messageResponse.json()); if (usersResponse.ok) setUsers(await usersResponse.json()); }; useEffect(() => { load(); }, []); const send = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const result = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); if (result.ok) { setOpen(false); setNotice("Mensaje enviado"); load(); } }; return <section className="panel"><div className="panel-head"><h3>Bandeja de entrada</h3><button className="primary small" onClick={() => setOpen(true)}>Nuevo mensaje</button></div>{messages.length ? messages.map((message) => <div className="message" key={message.id}><div className="avatar pink">{initials(message.sender.displayName)}</div><div className="message-copy"><strong>{message.sender.displayName}</strong><p><b>{message.subject}</b> · {message.body}</p></div><time>{new Date(message.createdAt).toLocaleDateString("es-AR")}</time></div>) : <p className="muted">Todavía no tienes mensajes.</p>}{open && <form className="compose" onSubmit={send}><select name="recipientId" required defaultValue=""><option value="" disabled>Elegir contacto</option>{users.map((contact) => <option value={contact.id} key={contact.id}>{contact.displayName}</option>)}</select><input name="subject" placeholder="Asunto" required /><textarea name="body" placeholder="Escribe tu mensaje" required /><button className="primary" type="submit">Enviar</button></form>}</section>; }

function MessagesView({ setNotice, selectedRecipientId }: { setNotice: (value: string) => void; selectedRecipientId?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [messageResponse, usersResponse] = await Promise.all([fetch("/api/messages"), fetch("/api/users")]);
      if (!messageResponse.ok || !usersResponse.ok) throw new Error("No se pudo cargar la bandeja.");
      setMessages(await messageResponse.json());
      setUsers(await usersResponse.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la bandeja.");
    }
  };

  useEffect(() => { void load(); }, []);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const result = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      const data = await readJsonResponse(result, "No se pudo enviar el mensaje.");
      if (!result.ok) { setError(data.error ?? "No se pudo enviar el mensaje."); return; }
      setOpen(false);
      setNotice("Mensaje enviado correctamente.");
      void load();
    } catch { setError("Error de conexión al enviar el mensaje."); }
  };

  return <section className="panel"><div className="panel-head"><h3>Bandeja de entrada</h3><button className="primary small" type="button" onClick={() => setOpen(true)}>Nuevo mensaje</button></div>{error && <p className="form-error" role="alert">{error}</p>}{messages.length ? messages.map((message) => <div className="message" key={message.id}><div className="avatar pink">{initials(message.sender.displayName)}</div><div className="message-copy"><strong>{message.sender.displayName}</strong><p><b>{message.subject}</b> · {message.body}</p></div><time>{new Date(message.createdAt).toLocaleDateString("es-AR")}</time></div>) : <p className="muted">Todavía no tienes mensajes.</p>}{open && <form className="compose" onSubmit={send}><label htmlFor="message-recipient">Destinatario</label><select id="message-recipient" name="recipientId" required defaultValue={selectedRecipientId ?? ""}><option value="" disabled>Elegir contacto</option>{users.map((contact) => <option value={contact.id} key={contact.id}>{contact.displayName}</option>)}</select><label htmlFor="message-subject">Asunto</label><input id="message-subject" name="subject" placeholder="Asunto" required /><label htmlFor="message-body">Mensaje</label><textarea id="message-body" name="body" placeholder="Escribe tu mensaje" required /><button className="primary" type="submit">Enviar</button></form>}</section>;
}

function ContactsView({ onMessage }: { onMessage: (id: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/users").then(async (response) => { if (!response.ok) throw new Error("No se pudieron cargar los contactos."); setUsers(await response.json()); }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los contactos.")); }, []);
  return <section className="panel"><h3>Contactos activos</h3>{error && <p className="form-error" role="alert">{error}</p>}{users.map((contact) => <div className="room" key={contact.id}><div className="avatar green">{initials(contact.displayName)}</div><div><strong>{contact.displayName}</strong><small>{contact.email}</small></div><button className="join" type="button" onClick={() => onMessage(contact.id)}>Mensaje</button></div>)}</section>;
}

function ApprovalsView({ setNotice }: { setNotice: (value: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const load = () => fetch("/api/admin/users").then(async (response) => { if (!response.ok) throw new Error("No se pudieron cargar las aprobaciones."); return response.json(); }).then(setUsers).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las aprobaciones."));
  useEffect(() => { void load(); }, []);
  const update = async (userId: string, action: "approve" | "suspend") => {
    setError("");
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action }) });
      const data = await readJsonResponse(response, "No se pudo actualizar la cuenta.");
      if (!response.ok) { setError(data.error ?? "No se pudo actualizar la cuenta."); return; }
      setNotice("Cuenta actualizada correctamente.");
      void load();
    } catch { setError("Error de conexión al actualizar la cuenta."); }
  };
  return <section className="panel"><div className="panel-head"><h3>Cuentas pendientes</h3><span className="count">{users.length}</span></div>{error && <p className="form-error" role="alert">{error}</p>}{users.length ? users.map((pending) => <div className="room" key={pending.id}><div className="avatar orange">{initials(pending.displayName)}</div><div><strong>{pending.displayName}</strong><small>{pending.email} · {pending.role === "GUEST" ? "Invitado" : "Usuario"}</small></div><button className="join" type="button" onClick={() => update(pending.id, "approve")}>Aprobar</button><button className="join danger" type="button" onClick={() => update(pending.id, "suspend")}>Rechazar</button></div>) : <p className="muted">No hay cuentas pendientes.</p>}</section>;
}

function UserPicker({ users, name = "userIds" }: { users: User[]; name?: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const available = users.filter((user) => !selected.includes(user.id) && `${user.displayName} ${user.email}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (userId: string) => setSelected((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  return <div className="user-picker"><div className="user-tags">{selected.map((userId) => { const user = users.find((item) => item.id === userId); return user && <button type="button" className="user-tag" key={user.id} onClick={() => toggle(user.id)}>{user.displayName} ×</button>; })}</div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuarios por nombre o email" /><div className="user-results">{available.slice(0, 8).map((user) => <button type="button" className="user-result" key={user.id} onClick={() => toggle(user.id)}><span className="mini-avatar">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small></span><b>+</b></button>)}{!available.length && <small className="muted">No hay usuarios disponibles.</small>}</div>{selected.map((userId) => <input key={userId} type="hidden" name={name} value={userId} />)}</div>;
}

async function readJsonResponse(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return { error: fallback };
  try { return JSON.parse(text); } catch { return { error: fallback }; }
}

class CameraImageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CameraImageUnavailableError";
  }
}

const waitForCamera = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function frameContainsVisibleImage(video: HTMLVideoElement) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) return false;

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let luminanceTotal = 0;
    let luminanceSquares = 0;
    let luminanceMin = 255;
    let luminanceMax = 0;
    let visiblePixels = 0;
    const pixelCount = pixels.length / 4;

    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = (pixels[index] * 0.2126) + (pixels[index + 1] * 0.7152) + (pixels[index + 2] * 0.0722);
      luminanceTotal += luminance;
      luminanceSquares += luminance * luminance;
      luminanceMin = Math.min(luminanceMin, luminance);
      luminanceMax = Math.max(luminanceMax, luminance);
      if (luminance >= 24) visiblePixels += 1;
    }

    const average = luminanceTotal / pixelCount;
    const variance = (luminanceSquares / pixelCount) - (average * average);
    return average >= 16 && visiblePixels / pixelCount >= 0.08 && luminanceMax - luminanceMin >= 24 && variance >= 20;
  } catch {
    return false;
  }
}

async function verifyCameraProducesVisibleImage(track: LocalVideoTrack) {
  const mediaTrack = track.mediaStreamTrack;
  const settings = mediaTrack?.getSettings();
  if (!mediaTrack || mediaTrack.readyState !== "live" || !mediaTrack.enabled || !settings.deviceId || !settings.width || !settings.height || !settings.frameRate || settings.frameRate < 1) {
    throw new CameraImageUnavailableError("La cámara no está activa.");
  }

  const preview = document.createElement("video");
  preview.autoplay = true;
  preview.muted = true;
  preview.playsInline = true;
  preview.setAttribute("aria-hidden", "true");
  preview.style.position = "fixed";
  preview.style.left = "-10000px";
  preview.style.width = "160px";
  preview.style.height = "120px";
  preview.srcObject = new MediaStream([mediaTrack]);
  document.body.appendChild(preview);

  try {
    await preview.play();
    const deadline = Date.now() + 8000;
    let visibleFrames = 0;

    while (Date.now() < deadline) {
      if (mediaTrack.readyState !== "live" || !mediaTrack.enabled) {
        throw new CameraImageUnavailableError("La cámara dejó de estar activa.");
      }

      if (!mediaTrack.muted && preview.videoWidth > 0 && preview.videoHeight > 0) {
        visibleFrames = frameContainsVisibleImage(preview) ? visibleFrames + 1 : 0;
        if (visibleFrames >= 3) return;
      }

      await waitForCamera(200);
    }

    throw new CameraImageUnavailableError("La cámara está permitida, pero no entrega una imagen visible. Revisa la tapa, la iluminación o la cámara seleccionada.");
  } finally {
    preview.pause();
    preview.srcObject = null;
    preview.remove();
  }
}

function Rooms({ setNotice, guestMode = false, lockedRoom }: { setNotice: (value: string) => void; guestMode?: boolean; lockedRoom?: string }) {
  const [roomName, setRoomName] = useState(lockedRoom ?? "");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMicrophone, setSelectedMicrophone] = useState("");
  const [sidePanel, setSidePanel] = useState<"participants" | "chat" | null>("participants");
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState<Array<{ id: string; name: string }>>([]);
  const [creatorIdentity, setCreatorIdentity] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; status: "online" | "muted" }>>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [meetings, setMeetings] = useState<Array<{ id: string; title: string; roomName: string; scheduledAt: string; status?: "SCHEDULED" | "CANCELLED" }>>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [lastGuestInviteLink, setLastGuestInviteLink] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<{ id: string; title: string; scheduledAt: string } | null>(null);
  const [screenTrack, setScreenTrack] = useState<any | null>(null);
  const [chatLog, setChatLog] = useState<ChatEntry[]>([
    { from: "Sistema", text: "La reunión está lista para comenzar." },
    { from: "Tú", text: "Prueba de audio y video en curso." }
  ]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const meetingStageRef = useRef<HTMLDivElement | null>(null);
  const localScreenRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteScreenRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  useEffect(() => {
    const roomFromLink = new URLSearchParams(window.location.search).get("room");
    if (roomFromLink) setRoomName(roomFromLink);
    if (!guestMode) {
      Promise.all([fetch("/api/users"), fetch("/api/meetings")]).then(async ([usersResponse, meetingsResponse]) => {
        if (usersResponse.ok) setUsers(await usersResponse.json());
        if (meetingsResponse.ok) setMeetings(await meetingsResponse.json());
      });
    }
  }, [guestMode]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setCameraDevices(devices.filter((device) => device.kind === "videoinput"));
      setMicrophoneDevices(devices.filter((device) => device.kind === "audioinput"));
    }).catch(() => setNotice("Advertencia: no se pudieron listar los dispositivos multimedia."));
  }, [setNotice]);

  useEffect(() => {
    if (!room) return;
    attachLocalPreview(room);
  }, [room]);

  useEffect(() => {
    if (!showTermsModal) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setShowTermsModal(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showTermsModal]);

  useEffect(() => {
    if (!connected || !room) return;

    let failedChecks = 0;
    let closingForCamera = false;
    const checkCamera = () => {
      if (closingForCamera) return;
      const publication = Array.from(room.localParticipant.videoTrackPublications.values())
        .find((candidate) => candidate.track?.source === Track.Source.Camera);
      const cameraTrack = publication?.track as LocalVideoTrack | undefined;
      const mediaTrack = cameraTrack?.mediaStreamTrack;
      const preview = localVideoRef.current;
      const cameraIsVisible = Boolean(
        mediaTrack &&
        mediaTrack.readyState === "live" &&
        mediaTrack.enabled &&
        !mediaTrack.muted &&
        preview &&
        frameContainsVisibleImage(preview)
      );

      failedChecks = cameraIsVisible ? 0 : failedChecks + 1;
      if (failedChecks < 3) return;

      closingForCamera = true;
      window.clearInterval(intervalId);
      void room.disconnect().finally(() => {
        setNotice("La llamada se cerró porque la cámara dejó de mostrar una imagen visible. Revisa la cámara antes de volver a entrar.");
      });
    };

    const intervalId = window.setInterval(checkCamera, 3000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, room, setNotice]);

  useEffect(() => {
    if (!connected || guestMode) return;
    fetch(`/api/rooms/messages?roomName=${encodeURIComponent(roomName)}`).then(async (response) => {
      if (response.ok) setChatLog(await response.json());
    }).catch(() => setNotice("No se pudo cargar el historial del chat."));
  }, [connected, roomName, guestMode]);

  useEffect(() => {
    if (screenTrack && localScreenRef.current) {
      screenTrack.attach(localScreenRef.current);
    }
    return () => {
      if (screenTrack) screenTrack.detach();
    };
  }, [screenTrack]);

  const attachLocalPreview = (nextRoom: Room) => {
    const localVideo = Array.from(nextRoom.localParticipant.videoTrackPublications.values()).find((publication) => publication.source === Track.Source.Camera && publication.track);
    const localAudio = Array.from(nextRoom.localParticipant.audioTrackPublications.values()).find((publication) => publication.track);

    if (localVideo?.track && localVideoRef.current) {
      localVideo.track.detach();
      localVideo.track.attach(localVideoRef.current);
    }

    if (localAudio?.track && localAudioRef.current) {
      localAudio.track.detach();
      localAudio.track.attach(localAudioRef.current);
    }
  };

  const attachParticipantMedia = (participant: any) => {
    const videoPub = Array.from(participant.videoTrackPublications.values()).find((publication: any) => publication.source === Track.Source.Camera && (publication as any).track);
    const audioPub = Array.from(participant.audioTrackPublications.values()).find((publication: any) => (publication as any).track);
    const key = participant.identity;

    if ((videoPub as any)?.track && remoteVideoRefs.current[key]) {
      (videoPub as any).track.detach();
      (videoPub as any).track.attach(remoteVideoRefs.current[key]);
    }

    if ((audioPub as any)?.track && remoteAudioRefs.current[key]) {
      (audioPub as any).track.detach();
      (audioPub as any).track.attach(remoteAudioRefs.current[key]);
    }
  };

  const bindRemoteParticipant = (participantId: string, element: HTMLVideoElement | null) => {
    remoteVideoRefs.current[participantId] = element;

    if (element && room) {
      const participant = room.remoteParticipants.get(participantId);
      if (participant) attachParticipantMedia(participant);
    }
  };

  const attachRemoteScreen = (participant: any) => {
    const publication = participant.getTrackPublication?.(Track.Source.ScreenShare) ?? Array.from(participant.videoTrackPublications.values()).find((candidate: any) => candidate.source === Track.Source.ScreenShare);
    if (publication?.track && remoteScreenRefs.current[participant.identity]) {
      publication.track.detach();
      publication.track.attach(remoteScreenRefs.current[participant.identity]);
    }
  };

  const bindRemoteScreen = (participantId: string, element: HTMLVideoElement | null) => {
    remoteScreenRefs.current[participantId] = element;
    if (element && room) {
      const participant = room.remoteParticipants.get(participantId);
      if (participant) attachRemoteScreen(participant);
    }
  };

  const connect = async () => {
    if (connecting) return;
    if (!roomName.trim()) {
      setNotice("Error: escribe un nombre de sala antes de conectar.");
      return;
    }
    // Primero mostrar términos
    setShowTermsModal(true);
  };

  const confirmAndConnect = async () => {
    if (connecting) return;
    setShowTermsModal(false);
    setConnecting(true);
    let videoTrack: LocalVideoTrack | null = null;
    let audioTrack: any = null;
    let nextRoom: Room | null = null;
    let joined = false;
    try {
      // No alcanza con el permiso: la cámara debe entregar fotogramas visibles.
      const availableCameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      if (availableCameras.length === 0 || (selectedCamera && !availableCameras.some((device) => device.deviceId === selectedCamera))) {
        throw new CameraImageUnavailableError("No se detectó una cámara conectada. Conecta una cámara física antes de iniciar la llamada.");
      }
      videoTrack = await createLocalVideoTrack({ facingMode: "user", ...(selectedCamera ? { deviceId: selectedCamera } : {}) });
      await verifyCameraProducesVisibleImage(videoTrack);
      audioTrack = await createLocalAudioTrack(selectedMicrophone ? { deviceId: selectedMicrophone } : undefined);

      const response = await fetch("/api/rooms/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomName })
      });
      const result = await response.json();
      if (!response.ok) return setNotice(result.error ?? "No se pudo obtener el acceso a la sala.");
      if (!result.url || !result.token) return setNotice("LiveKit no devolvió credenciales válidas. Revisa su configuración.");

      const connectedRoom = new Room({ adaptiveStream: true, dynacast: true });
      nextRoom = connectedRoom;

      nextRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        setParticipants((current) => {
          const exists = current.some((item) => item.id === participant.identity);
          if (exists) return current;
          return [...current, { id: participant.identity, name: participant.name || "Participante", status: "online" }];
        });
        setNotice(`${participant.name || "Participante"} se unió a la sala.`);
        attachParticipantMedia(participant);
      });

      nextRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        setParticipants((current) => current.filter((item) => item.id !== participant.identity));
        setRemoteScreens((current) => current.filter((item) => item.id !== participant.identity));
      });

      nextRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (publication.source === Track.Source.ScreenShare) {
          setRemoteScreens((current) => current.some((item) => item.id === participant.identity) ? current : [...current, { id: participant.identity, name: participant.name || "Participante" }]);
          attachRemoteScreen(participant);
        } else {
          attachParticipantMedia(participant);
        }
      });

      nextRoom.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        if (publication.source === Track.Source.ScreenShare) {
          track.detach();
          setRemoteScreens((current) => current.filter((item) => item.id !== participant.identity));
        }
      });

      nextRoom.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const entry = JSON.parse(new TextDecoder().decode(payload)) as ChatEntry & { type?: string; targetId?: string; muted?: boolean };
          if (entry.type === "mute" && participant?.identity === result.creatorId && entry.targetId === connectedRoom.localParticipant.identity) {
            void connectedRoom.localParticipant.setMicrophoneEnabled(!entry.muted);
            setMicrophoneEnabled(!entry.muted);
            setParticipants((current) => current.map((person) => person.id === entry.targetId ? { ...person, status: entry.muted ? "muted" : "online" } : person));
          } else if (!guestMode && entry.from && entry.text) setChatLog((current) => [...current, entry]);
        } catch {
          setNotice("Se recibió un mensaje de sala no válido.");
        }
      });

      nextRoom.on(RoomEvent.LocalTrackPublished, () => attachLocalPreview(connectedRoom));
      nextRoom.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setRoom(null);
        setParticipants([]);
        setCreatorIdentity(null);
        setRemoteScreens([]);
        setScreenTrack(null);
        setScreenSharing(false);
        setNotice("Has salido de la sala.");
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      });

      await nextRoom.connect(result.url, result.token);

      for (const participant of nextRoom.remoteParticipants.values()) {
        setParticipants((current) => current.some((item) => item.id === participant.identity) ? current : [...current, { id: participant.identity, name: participant.name || "Participante", status: "online" }]);
        attachParticipantMedia(participant);
        attachRemoteScreen(participant);
      }

      await nextRoom.localParticipant.publishTrack(videoTrack);
      await nextRoom.localParticipant.publishTrack(audioTrack);

      setRoom(nextRoom);
      setConnected(true);
      // La pantalla completa se solicita solamente después de validar la sala,
      // obtener credenciales y conectar/publicar los medios correctamente.
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => undefined);
      }
      setCameraEnabled(true);
      setMicrophoneEnabled(true);
      setIsCreator(Boolean(result.isCreator));
      setCreatorIdentity(result.creatorId ?? null);
      setParticipants([
        { id: nextRoom.localParticipant.identity, name: nextRoom.localParticipant.name || "Tú", status: "online" },
        ...Array.from(nextRoom.remoteParticipants.values()).map((participant) => ({ id: participant.identity, name: participant.name || "Participante", status: "online" as const })),
      ]);
      joined = true;
      setNotice(`Conectado a ${roomName}`);

    } catch (error: any) {
      setConnected(false);
      if (error.name === "CameraImageUnavailableError") {
        setNotice(error.message);
      } else if (error.name === "NotAllowedError") {
        setNotice("Debes permitir acceso a cámara y micrófono para conectarte a la reunión.");
      } else if (error.name === "NotFoundError") {
        setNotice("No se encontró una cámara o micrófono disponible.");
      } else if (error.name === "NotReadableError") {
        setNotice("La cámara o el micrófono están siendo usados por otra aplicación.");
      } else if (error.name === "TypeError" || error.message?.includes("WebSocket")) {
        setNotice("No se pudo conectar con LiveKit en ws://localhost:7880. Comprueba que el servicio esté iniciado.");
      } else {
        setNotice(`No se pudo establecer la conexión multimedia: ${error.message || "error desconocido"}`);
      }
    } finally {
      if (!joined) {
        videoTrack?.stop();
        audioTrack?.stop();
        void nextRoom?.disconnect();
      }
      setConnecting(false);
    }
  };

  const disconnect = () => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }
    room?.disconnect();
    setConnected(false);
    setRoom(null);
    setCreatorIdentity(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setNotice("La reunión fue cerrada.");
  };

  const toggleCamera = async () => {
    // La cámara no se puede desactivar en las llamadas
    setNotice("⛔ El uso de cámara es obligatorio durante la videollamada. No puedes desactivarla.");
  };

  const toggleFullscreen = async () => {
    if (!meetingStageRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await meetingStageRef.current.requestFullscreen();
  };

  const toggleMicrophone = async () => {
    if (!room) return;
    const nextState = !microphoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(nextState);
    setMicrophoneEnabled(nextState);
    setNotice(nextState ? "Micrófono activado." : "Micrófono silenciado.");
  };

  const toggleParticipantMute = async (participantId: string, muted: boolean) => {
    if (!room || !isCreator || participantId === room.localParticipant.identity) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "mute", targetId: participantId, muted })), { reliable: true });
    setParticipants((current) => current.map((person) => person.id === participantId ? { ...person, status: muted ? "muted" : "online" } : person));
    setNotice(muted ? "Participante silenciado." : "Micrófono del participante habilitado.");
  };

  const toggleScreenShare = async () => {
    if (!room) return;
    if (screenTrack) {
      await room.localParticipant.unpublishTrack(screenTrack);
      screenTrack.stop();
      screenTrack.detach();
      setScreenTrack(null);
      setScreenSharing(false);
      setNotice("Compartir pantalla detenido.");
      return;
    }
    try {
      const [track] = await createLocalScreenTracks({ audio: false });
      track.on("ended", () => {
        setScreenTrack(null);
        setScreenSharing(false);
      });
      await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare });
      setScreenTrack(track);
      setScreenSharing(true);
      if (localScreenRef.current) track.attach(localScreenRef.current);
      setNotice("Compartiendo pantalla.");
    } catch (error: any) {
      if (error?.name !== "NotAllowedError") setNotice("No se pudo compartir la pantalla.");
    }
  };

  const inviteGuests = async () => {
    setInviteOpen(true);
  };

  const sendRoomInvites = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = await fetch("/api/rooms/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomName, userIds: formData.getAll("userIds") }) });
    const data = await readJsonResponse(result, "No se pudieron enviar las invitaciones.");
    if (!result.ok) return setNotice(data.error ?? "No se pudieron enviar las invitaciones.");
    setInviteOpen(false);
    setNotice(`Invitación enviada a ${data.sentCount} usuario(s).`);
  };

  const sendGuestInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const response = await fetch("/api/rooms/invite-guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName, email: formData.get("guestEmail") }),
    });
    const data = await readJsonResponse(response, "No se pudo crear la invitación externa.");
    if (!response.ok) return setNotice(data.error ?? "No se pudo crear la invitación externa.");
    setLastGuestInviteLink(data.link);
    setNotice(data.emailQueued ? "Invitación creada; el email quedó en cola de envío." : "La invitación fue creada. Copia el enlace manualmente si es necesario.");
    form.reset();
  };

  const scheduleMeeting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const guestEmails = String(formData.get("guestEmails") ?? "").split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean);
    const title = String(formData.get("title") ?? "");
    const scheduledAt = new Date(String(formData.get("scheduledAt"))).toISOString();
    const result = await fetch(editingMeeting ? `/api/meetings/${editingMeeting.id}` : "/api/meetings", { method: editingMeeting ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingMeeting ? { title, scheduledAt } : { title, scheduledAt, userIds: formData.getAll("userIds"), guestEmails }) });
    const data = await readJsonResponse(result, "No se pudo programar la reunión.");
    if (!result.ok) return setNotice(`Error: ${data.error ?? "No se pudo guardar la reunión."}`);
    setScheduleOpen(false);
    setEditingMeeting(null);
    setMeetings((current) => editingMeeting ? current.map((meeting) => meeting.id === editingMeeting.id ? { ...meeting, ...data } : meeting) : [...current, data].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)));
    setNotice(editingMeeting ? "Reunión actualizada correctamente." : data.emailQueued ? `Reunión programada. Los enlaces quedaron en cola para ${data.invitedCount} usuario(s).` : "Reunión programada. Copia el enlace si algún email no llega.");
  };

  const cancelMeeting = async (meetingId: string) => {
    const response = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
    const data = await readJsonResponse(response, "No se pudo cancelar la reunión.");
    if (!response.ok) return setNotice(`Error: ${data.error ?? "No se pudo cancelar la reunión."}`);
    setMeetings((current) => current.filter((meeting) => meeting.id !== meetingId));
    setNotice("Reunión cancelada.");
  };

  const sendChatMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = message.trim();
    if (!value) return;
    const entry = { from: "Tú", text: value };
    setChatLog((previous) => [...previous, entry]);
    const saved = await fetch("/api/rooms/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomName, body: value }) });
    if (!saved.ok) setNotice("El mensaje se mostró localmente, pero no se pudo guardar.");
    if (room) {
      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(entry)), { reliable: true });
    }
    setMessage("");
    setNotice("Mensaje enviado a la sala.");
  };

  return (
    <section className="panel room-screen">
      <div className="panel-head">
        <div>
          <span className="eyebrow">LiveKit self-hosted</span>
          <h3>Sala de videollamada</h3>
        </div>
        <span className={connected ? "live-label" : "count"}>{connected ? "● En vivo" : "Desconectada"}</span>
      </div>

      <p className="muted">{guestMode ? "Has ingresado mediante una invitación. El navegador pedirá acceso a cámara y micrófono." : "Crea o únete a una sala. El navegador pedirá acceso a cámara y micrófono para participar."}</p>

      <div className="room-form">
        <label htmlFor="room-name">Nombre de la sala</label><input id="room-name" value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Ej.: equipo-ventas" readOnly={guestMode} required minLength={3} />
        <button className="primary" onClick={connect} disabled={connected || connecting}>{connected ? "Conectado" : connecting ? "Verificando cámara..." : "Conectar"}</button>
      </div>
      {!connected && <div className="device-selector"><label htmlFor="camera-device">Cámara</label><select id="camera-device" value={selectedCamera} onChange={(event) => setSelectedCamera(event.target.value)}><option value="">Cámara predeterminada</option>{cameraDevices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}</select><label htmlFor="microphone-device">Micrófono</label><select id="microphone-device" value={selectedMicrophone} onChange={(event) => setSelectedMicrophone(event.target.value)}><option value="">Micrófono predeterminado</option>{microphoneDevices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Micrófono ${index + 1}`}</option>)}</select><small className="muted">La cámara se comprobará antes de entrar y debe mostrar una imagen visible.</small></div>}

      {showTermsModal && (
        <div className="modal-overlay" onClick={() => setShowTermsModal(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="call-terms-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="call-terms-title">⚠️ Condiciones de Uso de VideoSystem</h2>
            <p>
              <strong>AVISO IMPORTANTE:</strong> Al entrar a esta videollamada, aceptas lo siguiente:
            </p>
            <ul style={{ fontSize: "12px", lineHeight: "1.6", color: "#666" }}>
              <li><strong>Uso obligatorio de cámara y micrófono:</strong> Debes permitir el acceso y la cámara debe mostrar una imagen visible. Ambos deben permanecer activos durante toda la llamada.</li>
              <li><strong>Privacidad:</strong> Está prohibido grabar o capturar esta videollamada sin consentimiento.</li>
              <li><strong>Control de llamada:</strong> Solo el creador puede silenciar a otros participantes. Nadie puede desactivar su video.</li>
              <li><strong>Política de privacidad:</strong> VideoSystem almacena datos de sesión para seguridad y auditoría. No se grabarán las reuniones sin consentimiento.</li>
              <li><strong>Suspensión de cuenta:</strong> Cualquier violación de estas reglas resultará en la suspensión permanente de tu cuenta y acciones legales si corresponde.</li>
            </ul>
            <div className="modal-buttons">
              <button className="modal-button" onClick={() => setShowTermsModal(false)}>
                Cancelar
              </button>
              <button className="modal-button accept" onClick={confirmAndConnect} disabled={connecting}>
                {connecting ? "Verificando cámara..." : "Aceptar y conectar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {connected ? (
        <div className="meeting-shell">
          <div className="meeting-stage" ref={meetingStageRef}>
            <div className="meeting-header">
              <div>
                <span className="session-badge">Reunión activa</span>
                <strong>{roomName}</strong>
              </div>
              <div className="meeting-header-actions">
                <button className="control-button" onClick={toggleFullscreen} type="button">Pantalla completa</button>
                <span className="hint">Tu audio y video están en vivo (obligatorio)</span>
              </div>
            </div>

            <div className="meeting-grid">
              <div className="video-panel main-panel">
                <video ref={localVideoRef} autoPlay muted playsInline className="local-video" />
                <span className="participant-tag">Tú</span>
                <audio ref={localAudioRef} autoPlay />
                {participants.filter((person) => person.id !== room?.localParticipant.identity).length > 0 && <div className="remote-video-grid">
                  {participants.filter((person) => person.id !== room?.localParticipant.identity).map((person) => <div className="remote-tile" key={person.id}>
                    <video ref={(element) => bindRemoteParticipant(person.id, element)} autoPlay playsInline className="remote-video" />
                    <audio ref={(element) => { remoteAudioRefs.current[person.id] = element; if (element && room) { const remote = room.remoteParticipants.get(person.id); if (remote) attachParticipantMedia(remote); } }} autoPlay />
                    <span className="tile-name">{person.name}</span>
                  </div>)}
                </div>}
              </div>

              <div className={`meeting-side-panel ${sidePanel ? "" : "is-collapsed"}`}>
                <div className="side-panel-tabs">
                  <button className={sidePanel === "participants" ? "is-active" : ""} onClick={() => setSidePanel(sidePanel === "participants" ? null : "participants")} type="button">Participantes <span>{participants.length}</span></button>
                  {!guestMode && <button className={sidePanel === "chat" ? "is-active" : ""} onClick={() => setSidePanel(sidePanel === "chat" ? null : "chat")} type="button">Chat</button>}
                  <button className="side-panel-minimize" onClick={() => setSidePanel(null)} type="button" aria-label="Minimizar panel">−</button>
              </div>
                {sidePanel === "participants" && <div className="participant-list">
                  {participants.map((person) => <div className="participant-item" key={person.id}><div className="mini-avatar">{initials(person.name)}</div><div><strong>{person.name}</strong><small>{person.status === "online" ? "En línea" : "Silenciado"}</small></div>{isCreator && person.id !== room?.localParticipant.identity && <button className="participant-mute" type="button" onClick={() => toggleParticipantMute(person.id, person.status === "online")}>{person.status === "online" ? "Silenciar" : "Activar"}</button>}</div>)}
                </div>}
                {!guestMode && sidePanel === "chat" && <div className="side-chat-content">
                  <div className="chat-list">{chatLog.map((entry, index) => <div className="chat-message" key={`${entry.from}-${index}`}><strong>{entry.from}</strong><span>{entry.text}</span></div>)}</div>
                  <form className="chat-form" onSubmit={sendChatMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escribe un mensaje" /><button className="primary small" type="submit">Enviar</button></form>
                </div>}
            </div>
              </div>

            <div className="meeting-controls">
              <button className={`control-button ${microphoneEnabled ? "is-active" : "is-muted"}`} onClick={toggleMicrophone} type="button" title="Activar o silenciar tu micrófono">
                {microphoneEnabled ? "Micrófono" : "Mic apagado"}
              </button>
              <button className="control-button is-active" disabled type="button" title="La cámara es obligatoria">
                📹 Cámara (Obligatoria)
              </button>
              <button className={`control-button ${screenSharing ? "is-active" : ""}`} onClick={toggleScreenShare} type="button">{screenSharing ? "Dejar de compartir" : "Compartir pantalla"}</button>
              {!guestMode && <button className={`control-button ${sidePanel === "chat" ? "is-active" : ""}`} onClick={() => setSidePanel(sidePanel === "chat" ? null : "chat")} type="button">Chat</button>}
              {!guestMode && <button className="control-button" onClick={inviteGuests} type="button">Invitar</button>}
              <button className="control-button danger" onClick={disconnect} type="button">Salir</button>
            </div>

          {(screenSharing || remoteScreens.length > 0) && <div className="screen-share-panel">{screenSharing && <div><small className="screen-label">Tu pantalla</small><video ref={localScreenRef} autoPlay playsInline className="screen-video" /></div>}{remoteScreens.map((screen) => <div key={screen.id}><small className="screen-label">Pantalla de {screen.name}</small><video ref={(element) => bindRemoteScreen(screen.id, element)} autoPlay playsInline className="screen-video" /></div>)}</div>}

          </div>
        </div>
      ) : (
        <div className="video-placeholder">Para conectar, la cámara debe estar activa y mostrar una imagen visible; el permiso por sí solo no es suficiente.</div>
      )}
      {!guestMode && inviteOpen && <div className="compose"><form className="compose" onSubmit={sendRoomInvites}><strong>Invitar usuarios registrados</strong><UserPicker users={users} /><button className="primary" type="submit">Enviar invitación</button></form><form className="compose" onSubmit={sendGuestInvite}><strong>Invitar una persona externa</strong><p className="muted">Recibirá un enlace personal para registrarse como invitado.</p><input name="guestEmail" type="email" placeholder="Email de la persona invitada" required /><button className="primary" type="submit">Crear y enviar invitación</button></form>{lastGuestInviteLink && <div className="room-form"><input value={lastGuestInviteLink} readOnly aria-label="Último enlace de invitado" /><button className="primary" type="button" onClick={() => navigator.clipboard.writeText(lastGuestInviteLink).then(() => setNotice("Enlace copiado."))}>Copiar enlace</button></div>}<button className="link-button" type="button" onClick={() => { setInviteOpen(false); setLastGuestInviteLink(""); }}>Cerrar</button></div>}
      {!guestMode && <button className="text-button" type="button" onClick={() => { setEditingMeeting(null); setScheduleOpen((value) => !value); }}>Programar reunión</button>}
      {!guestMode && scheduleOpen && <form className="compose" key={editingMeeting?.id ?? "new-meeting"} onSubmit={scheduleMeeting}><h4>{editingMeeting ? "Editar reunión" : "Programar reunión"}</h4><label htmlFor="meeting-title">Título</label><input id="meeting-title" name="title" placeholder="Título de la reunión" defaultValue={editingMeeting?.title ?? ""} required /><label htmlFor="meeting-date">Fecha y hora</label><input id="meeting-date" name="scheduledAt" type="datetime-local" defaultValue={editingMeeting ? new Date(editingMeeting.scheduledAt).toISOString().slice(0, 16) : ""} required min={new Date(Date.now() + 60000).toISOString().slice(0, 16)} />{!editingMeeting && <><strong>Usuarios registrados</strong><UserPicker users={users} /><strong>Personas externas</strong><textarea name="guestEmails" placeholder="Emails separados por coma o uno por línea" /></>}<button className="primary" type="submit">{editingMeeting ? "Guardar cambios" : "Programar y enviar enlaces"}</button></form>}
      {!guestMode && meetings.length > 0 && <div className="meeting-list"><h4>Próximas reuniones</h4>{meetings.map((meeting) => <div className="message" key={meeting.id}><div><strong>{meeting.title}</strong><p>{new Date(meeting.scheduledAt).toLocaleString("es-AR")}</p></div><button className="text-button" type="button" onClick={() => setRoomName(meeting.roomName)}>Usar sala</button><button className="text-button" type="button" onClick={() => { setEditingMeeting({ id: meeting.id, title: meeting.title, scheduledAt: meeting.scheduledAt }); setScheduleOpen(true); }}>Editar</button><button className="text-button danger" type="button" onClick={() => cancelMeeting(meeting.id)}>Cancelar</button></div>)}</div>}
    </section>
  );
}

function Contacts({ setView }: { setView: (view: string) => void }) { const [users, setUsers] = useState<User[]>([]); useEffect(() => { fetch("/api/users").then((response) => response.ok && response.json()).then((result) => result && setUsers(result)); }, []); return <section className="panel"><h3>Contactos activos</h3>{users.map((contact) => <div className="room" key={contact.id}><div className="avatar green">{initials(contact.displayName)}</div><div><strong>{contact.displayName}</strong><small>{contact.email}</small></div><button className="join" onClick={() => setView("mensajes")}>Mensaje</button></div>)}</section>; }

function Approvals({ setNotice }: { setNotice: (value: string) => void }) { const [users, setUsers] = useState<User[]>([]); const load = () => fetch("/api/admin/users").then((response) => response.ok && response.json()).then((result) => result && setUsers(result)); useEffect(() => { void load(); }, []); const update = async (userId: string, action: string) => { await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action }) }); setNotice("Estado de cuenta actualizado"); void load(); }; return <section className="panel"><div className="panel-head"><h3>Cuentas pendientes</h3><span className="count">{users.length}</span></div>{users.length ? users.map((pending) => <div className="room" key={pending.id}><div className="avatar orange">{initials(pending.displayName)}</div><div><strong>{pending.displayName}</strong><small>{pending.email} · {pending.role === "GUEST" ? "Invitado" : "Usuario"}</small></div><button className="join" onClick={() => update(pending.id, "approve")}>Aprobar</button><button className="join danger" onClick={() => update(pending.id, "suspend")}>Rechazar</button></div>) : <p className="muted">No hay cuentas pendientes.</p>}</section>; }

function Nav({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: string; children: string }) { return <button className={`nav-link ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span>{children}</button>; }
function initials(name: string) { return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function title(view: string) { return ({ mensajes: "Mensajes", salas: "Salas de videollamada", contactos: "Contactos", aprobaciones: "Aprobaciones", auditoria: "Auditoría" } as Record<string, string>)[view] ?? "VideoSystem"; }

