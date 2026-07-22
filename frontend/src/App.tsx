import { useCallback, useEffect, useRef, useState } from "react";

// ---- config -----------------------------------------------------------
// const WS_URL = "ws://10.239.225.152:8080"
const WS_URL = "ws://localhost:8080";
const MAX_RECONNECT_DELAY = 16000; // ms
const BASE_RECONNECT_DELAY = 1000; // ms
const MAX_ROOM_LEN = 80;
const MAX_IMAGE_DIMENSION = 1000; // px, longest side after resize
const IMAGE_QUALITY = 0.7; // jpeg compression quality
const MAX_IMAGE_BYTES = 1_500_000; // ~1.5MB after encoding, safety cap

// A roomId that happens to be a real CSS color name literally becomes the
// room's color ("red" -> red dot). Anything else, including free-text like
// "i am from blue team", falls back to the default signal accent.
function roomColor(roomId) {
  if (typeof window === "undefined" || !roomId) return "var(--accent)";
  const s = new Option().style;
  s.color = "";
  s.color = roomId;
  return s.color ? roomId : "var(--accent)";
}

function timeLabel(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Resize + compress an image file down to a data URL before sending it
// over the socket, so a full-res phone photo doesn't blow up the payload.
function fileToCompressedDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const scale = Math.min(
          1,
          MAX_IMAGE_DIMENSION / Math.max(img.width, img.height)
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [phase, setPhase] = useState("join"); // "join" | "chat"
  const [status, setStatus] = useState("connecting"); // connecting | open | closed | error
  const [attempt, setAttempt] = useState(0);
  const [imageError, setImageError] = useState("");
  const [sendingImage, setSendingImage] = useState(false);

  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRoomRef = useRef(null); // room currently joined; re-sent on reconnect
  const clientIdRef = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}`
  );
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const roomInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const addMessage = useCallback((entry) => {
    setMessages((prev) => [...prev, entry]);
  }, []);

  const sendJoin = useCallback((roomId) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        type: "join",
        payload: { roomId, clientId: clientIdRef.current },
      })
    );
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus("connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      attemptRef.current = 0;
      setAttempt(0);
      setStatus("open");
      // rejoin whatever room was active, whether this is the first
      // connection after a submitted join, or a reconnect mid-session
      if (activeRoomRef.current) sendJoin(activeRoomRef.current);
    };

    ws.onmessage = async (event) => {
      if (!mountedRef.current) return;
      
      let messageData = event.data;
      
      // Handle Blob data (convert to string first)
      if (messageData instanceof Blob) {
        try {
          messageData = await messageData.text();
        } catch (err) {
          console.error("Could not read Blob:", err);
          return;
        }
      }

      let text = "";
      let image = null;
      let own = false;

      try {
        const parsed = JSON.parse(messageData);
        if (parsed?.payload?.image) {
          image = parsed.payload.image;
          text = "";
          own = parsed.payload.clientId === clientIdRef.current;
        } else if (parsed?.payload?.message) {
          text = parsed.payload.message;
          own = parsed.payload.clientId === clientIdRef.current;
        }
      } catch (err) {
        // If it's not JSON and not a Blob, just ignore it
        console.warn("Received non-JSON message:", messageData);
        return;
      }

      addMessage({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text,
        image,
        own,
        at: new Date(),
      });
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setStatus("error");
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("closed");
      const delay = Math.min(
        BASE_RECONNECT_DELAY * 2 ** attemptRef.current,
        MAX_RECONNECT_DELAY
      );
      attemptRef.current += 1;
      setAttempt(attemptRef.current);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [addMessage, sendJoin]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (phase === "join") roomInputRef.current?.focus();
  }, [phase]);

  const handleJoin = (e) => {
    e.preventDefault();
    const roomId = roomInput.trim().slice(0, MAX_ROOM_LEN);
    if (!roomId) return;
    activeRoomRef.current = roomId;
    setMessages([]);
    setPhase("chat");
    // if we're already connected, send immediately — otherwise ws.onopen
    // will send it as soon as the socket comes up
    sendJoin(roomId);
  };

  const handleLeave = () => {
    activeRoomRef.current = null;
    setPhase("join");
    setRoomInput("");
    setMessages([]);
    setImageError("");
  };

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || status !== "open" || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        payload: {
          message: trimmed,
          roomId: activeRoomRef.current,
          clientId: clientIdRef.current,
        },
      })
    );
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleImageButtonClick = () => {
    if (status !== "open") return;
    fileInputRef.current?.click();
  };

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageError("That file isn't an image.");
      return;
    }

    setImageError("");
    setSendingImage(true);
    try {
      const dataUrl = await fileToCompressedDataURL(file);
      if (dataUrl.length > MAX_IMAGE_BYTES) {
        setImageError("Image is too large even after compression.");
        return;
      }
      if (status !== "open" || !wsRef.current) return;
      wsRef.current.send(
        JSON.stringify({
          type: "chat",
          payload: {
            image: dataUrl,
            roomId: activeRoomRef.current,
            clientId: clientIdRef.current,
          },
        })
      );
    } catch {
      setImageError("Couldn't process that image.");
    } finally {
      setSendingImage(false);
    }
  };

  const statusCopy = {
    connecting: attempt === 0 ? "connecting" : `reconnecting · attempt ${attempt}`,
    open: "live",
    closed: "offline",
    error: "connection error",
  }[status];

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

    :root {
      --bg: #0f1013;
      --surface: #17191e;
      --surface-2: #1f222a;
      --border: #2b2f38;
      --text: #eceae6;
      --text-muted: #888e99;
      --accent: #ff5a4e;
      --accent-dim: rgba(255, 90, 78, 0.16);
      --online: #3ddc84;
      --error: #ff6b6b;
    }

    * { box-sizing: border-box; }

    .chat-shell {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .chat-window {
      width: 100%;
      max-width: 480px;
      height: 640px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 24px 60px -20px rgba(0,0,0,0.6);
    }

    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
    }

    .room-tag {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.02em;
      min-width: 0;
    }

    .room-tag span.name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .room-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--room-color, var(--accent));
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--room-color, var(--accent)) 22%, transparent);
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
      text-transform: lowercase;
      flex-shrink: 0;
    }

    .signal {
      position: relative;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
      flex-shrink: 0;
    }
    .signal.live { background: var(--online); }
    .signal.error { background: var(--error); }
    .signal.live::before {
      content: "";
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 1px solid var(--online);
      animation: ping 1.8s cubic-bezier(0,0,0.2,1) infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .signal.live::before { animation: none; }
    }
    @keyframes ping {
      0% { transform: scale(1); opacity: 0.6; }
      75%, 100% { transform: scale(2.2); opacity: 0; }
    }

    .leave-btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 8px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .leave-btn:hover { color: var(--text); border-color: var(--text-muted); }

    /* ---- join screen ---- */
    .join-screen {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 32px;
      text-align: center;
    }
    .join-screen h1 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.02em;
      margin: 0;
    }
    .join-screen p {
      font-size: 13px;
      color: var(--text-muted);
      margin: -8px 0 0;
    }
    .join-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      max-width: 280px;
    }
    .join-form input {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      padding: 11px 13px;
      text-align: center;
    }
    .join-form input:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .join-form button {
      background: var(--accent);
      color: #171717;
      border: none;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 11px 13px;
      cursor: pointer;
      transition: transform 0.12s ease, opacity 0.12s ease;
    }
    .join-form button:hover:not(:disabled) { transform: translateY(-1px); }
    .join-form button:disabled { opacity: 0.45; cursor: not-allowed; }
    .join-hint {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 3px;
    }

    .empty-state {
      margin: auto;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
    }

    .bubble-row { display: flex; }
    .bubble-row.own { justify-content: flex-end; }
    .bubble-row.other { justify-content: flex-start; }

    .bubble {
      max-width: 78%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.45;
      word-wrap: break-word;
    }
    .bubble.other {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }
    .bubble.own {
      background: var(--accent-dim);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      border-bottom-right-radius: 4px;
    }

    .bubble.has-image {
      padding: 5px;
    }

    .bubble-image {
      display: block;
      max-width: 100%;
      max-height: 260px;
      border-radius: 10px;
      object-fit: cover;
    }

    .bubble.has-image .bubble-time {
      padding: 6px 6px 0;
    }

    .bubble-time {
      display: block;
      margin-top: 4px;
      font-size: 10px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-muted);
    }
    .bubble-row.own .bubble-time { text-align: right; }

    .composer {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 14px;
      border-top: 1px solid var(--border);
      background: var(--surface-2);
    }

    .composer-status {
      padding: 0 14px 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--error);
      margin-top: -6px;
    }

    .composer textarea {
      flex: 1;
      resize: none;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      padding: 10px 12px;
      max-height: 96px;
      line-height: 1.4;
    }
    .composer textarea:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .composer textarea:disabled { opacity: 0.5; cursor: not-allowed; }

    .icon-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 0.12s ease, opacity 0.12s ease, color 0.12s ease;
    }
    .icon-btn:hover:not(:disabled) { color: var(--text); transform: translateY(-1px); }
    .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .icon-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .send-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      border: none;
      background: var(--accent);
      color: #171717;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 0.12s ease, opacity 0.12s ease;
    }
    .send-btn:hover:not(:disabled) { transform: translateY(-1px); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `;

  return (
    <div className="chat-shell">
      <style>{styles}</style>

      <div
        className="chat-window"
        style={{ "--room-color": roomColor(activeRoomRef.current) }}
      >
        {phase === "join" ? (
          <>
            <div className="chat-header">
              <div className="room-tag">
                <span className="room-dot" style={{ background: "var(--text-muted)" }} />
                <span className="name">join a room</span>
              </div>
              <div className="status-pill">
                <span className={`signal ${status}`} />
                {statusCopy}
              </div>
            </div>

            <form className="join-screen" onSubmit={handleJoin}>
              <h1>enter a room to join</h1>
              <p>any string works — try a color name for a themed room</p>
              <div className="join-form">
                <input
                  ref={roomInputRef}
                  type="text"
                  placeholder="e.g. i am from blue team"
                  value={roomInput}
                  maxLength={MAX_ROOM_LEN}
                  onChange={(e) => setRoomInput(e.target.value)}
                />
                <button type="submit" disabled={!roomInput.trim()}>
                  Join room
                </button>
              </div>
              <span className="join-hint">
                {status === "open" ? "socket ready" : statusCopy}
              </span>
            </form>
          </>
        ) : (
          <>
            <div className="chat-header">
              <div className="room-tag">
                <span className="room-dot" />
                <span className="name" title={activeRoomRef.current}>
                  #{activeRoomRef.current}
                </span>
              </div>
              <div className="status-pill">
                <span className={`signal ${status}`} />
                {statusCopy}
              </div>
              <button className="leave-btn" onClick={handleLeave} type="button">
                Leave
              </button>
            </div>

            <div className="messages" ref={scrollRef}>
              {messages.length === 0 && (
                <p className="empty-state">no messages yet — say something</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`bubble-row ${m.own ? "own" : "other"}`}>
                  <div className={`bubble ${m.own ? "own" : "other"} ${m.image ? "has-image" : ""}`}>
                    {m.image ? (
                      <img className="bubble-image" src={m.image} alt="shared" />
                    ) : (
                      m.text
                    )}
                    <span className="bubble-time">{timeLabel(m.at)}</span>
                  </div>
                </div>
              ))}
            </div>

            {imageError && <p className="composer-status">{imageError}</p>}

            <div className="composer">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                style={{ display: "none" }}
              />
              <button
                className="icon-btn"
                onClick={handleImageButtonClick}
                disabled={status !== "open" || sendingImage}
                aria-label="Send a photo"
                type="button"
                title="Send a photo"
              >
                {sendingImage ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
                    <circle cx="8.5" cy="10.5" r="1.5" fill="currentColor" />
                    <path
                      d="M4 17l5-5 4 4 3-3 4 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                placeholder={status === "open" ? "Write your message…" : "Waiting for connection…"}
                value={input}
                disabled={status !== "open"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="send-btn"
                onClick={sendMessage}
                disabled={status !== "open" || !input.trim()}
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 12L20 4L13 20L11 13L4 12Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}