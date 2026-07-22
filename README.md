# How Your WebSocket Chat App Works 🚀

## Overview: The Big Picture

Your app has **3 main parts**:

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Frontend 1    │◄────────│  WebSocket Server │────────►│   Frontend 2    │
│   (Browser)     │   JSON  │    (Node.js)      │  JSON   │   (Browser)     │
└─────────────────┘         └──────────────────┘         └─────────────────┘
   User typing &               Relays messages            User receives &
   sending photos             between users               sees photos
```

---

## Part 1: The Frontend (React App)

### What Happens When You Join a Room

```javascript
// User enters "blue" and clicks "Join room"
const roomId = "blue";
const clientId = "550e8400-e29b-41d4-a716-446655440000"; // unique per user

// Frontend sends this to backend:
wsRef.current.send(JSON.stringify({
  type: "join",
  payload: { roomId, clientId }
}));
```

**What you're sending:**
- `type: "join"` - tells backend "I'm joining a room"
- `roomId` - the room name (everyone in "blue" can chat together)
- `clientId` - unique ID so backend knows which user you are

---

### What Happens When You Send a Text Message

```javascript
// User types "hello" and presses Enter
const message = "hello";

wsRef.current.send(JSON.stringify({
  type: "chat",
  payload: {
    message: "hello",              // the text
    roomId: "blue",                // which room
    clientId: "550e8400..."        // who sent it
  }
}));
```

**The flow:**
1. ✅ You type "hello"
2. ✅ Click send (or press Enter)
3. ✅ Frontend sends JSON to backend
4. ✅ Backend receives it
5. ✅ Backend forwards to everyone in "blue" room
6. ✅ Both users receive the message

---

### What Happens When You Send a Photo

This is more complex! Photos need to be **compressed** before sending.

```javascript
// User selects photo from file picker
const file = selectedFile; // e.g., photo.jpg (5MB)

// Step 1: Compress the image
const dataUrl = await fileToCompressedDataURL(file);
// Result: "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
// Size: ~200KB (instead of 5MB!) ✅

// Step 2: Send compressed image over WebSocket
wsRef.current.send(JSON.stringify({
  type: "chat",
  payload: {
    image: dataUrl,           // base64 encoded image
    roomId: "blue",
    clientId: "550e8400..."
  }
}));
```

#### How Image Compression Works

```javascript
function fileToCompressedDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    // Step 1: Read file as binary data
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Step 2: Create a canvas (invisible drawing surface)
        const canvas = document.createElement("canvas");
        
        // Step 3: Resize the image
        // If image is 4000x3000px, scale it to max 1000px
        const scale = Math.min(
          1,
          1000 / Math.max(4000, 3000)  // scale = 0.25
        );
        canvas.width = 4000 * 0.25;    // 1000px
        canvas.height = 3000 * 0.25;   // 750px
        
        // Step 4: Draw the resized image on canvas
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 1000, 750);
        
        // Step 5: Convert canvas to JPEG (70% quality)
        // This is the BASE64 string that gets sent over WebSocket
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
```

**Compression steps:**
1. Read the file
2. Load it as an image
3. Calculate resize ratio (max 1000px)
4. Draw resized image on canvas
5. Convert to JPEG at 70% quality
6. Result: base64 string

**Size savings:**
- Original photo: **5MB**
- After resize: **2MB**
- After JPEG compression: **200KB** ✅ (40x smaller!)

---

## Part 2: The Backend (Node.js WebSocket Server)

### What the Backend Does

The backend has **ONE job**: relay messages between users in the same room.

```typescript
let allSockets: User[] = [];  // List of connected users

// Structure:
// [
//   { socket: ws1, room: "blue", clientId: "550e8400..." },
//   { socket: ws2, room: "blue", clientId: "a1b2c3d4..." },
//   { socket: ws3, room: "red",  clientId: "xyz123..." }
// ]
```

### When Frontend Sends a Join Message

```typescript
socket.on("message", (message) => {
  const ParsedMessage = JSON.parse(message.toString());
  
  if (ParsedMessage.type === "join") {
    // Remove user from old room (if reconnecting)
    allSockets = allSockets.filter((u) => u.socket !== socket);
    
    // Add user to new room
    allSockets.push({
      socket,
      room: "blue",
      clientId: "550e8400..."
    });
    
    console.log("User joined room: blue, Total: 2");
  }
});
```

**What happens:**
1. ✅ Backend receives join message
2. ✅ Adds you to the "blue" room
3. ✅ Now backend knows: "This socket belongs to user in blue room"

---

### When Frontend Sends a Chat Message (Text or Image)

```typescript
if (ParsedMessage.type === "chat") {
  const textMessage = ParsedMessage.payload.message || "";     // "hello" or ""
  const imageData = ParsedMessage.payload.image || null;       // base64 or null
  const clientId = ParsedMessage.payload.clientId;             // "550e8400..."
  
  // Step 1: Find which room THIS user is in
  let senderRoom = null;
  for (let i = 0; i < allSockets.length; i++) {
    if (allSockets[i].socket === socket) {
      senderRoom = allSockets[i].room;  // "blue"
      break;
    }
  }
  
  // Step 2: Create message to relay
  // This message includes EVERYTHING: text, image, who sent it
  const messageToRelay = JSON.stringify({
    type: "chat",
    payload: {
      message: textMessage,     // "hello" (or empty if image)
      image: imageData,         // base64 string (or null if text)
      clientId: clientId,       // "550e8400..." ← IMPORTANT!
      roomId: senderRoom,       // "blue"
    },
  });
  
  // Step 3: Send to ALL users in the same room
  for (let i = 0; i < allSockets.length; i++) {
    if (allSockets[i].room === senderRoom) {  // Only "blue" room users
      allSockets[i].socket.send(messageToRelay);  // Send to each user
    }
  }
  
  console.log(`Relayed to 2 users in room: blue`);
}
```

**The relay happens:**
```
User1 sends: { message: "hello", image: null, clientId: "550e8400..." }
     ↓
Backend receives it
     ↓
Backend finds: "User1 is in blue room"
     ↓
Backend looks for all users in "blue" room
     ↓
Backend finds: User1 and User2
     ↓
Backend sends message to BOTH:
  - User1 receives it (will say "own message" because clientId matches)
  - User2 receives it (will say "other's message" because clientId doesn't match)
```

---

## Part 3: How Frontend Handles Incoming Messages

### When a Message Arrives

```javascript
ws.onmessage = async (event) => {
  // Backend sends: { type: "chat", payload: { message, image, clientId, roomId } }
  const parsed = JSON.parse(event.data);
  
  let text = "";
  let image = null;
  let own = false;
  
  // Check if this is an IMAGE message
  if (parsed?.payload?.image) {
    image = parsed.payload.image;  // Store the base64 image
    text = "";                      // No text for image messages
    own = parsed.payload.clientId === clientIdRef.current;  // Is it mine?
  }
  // OR check if this is a TEXT message
  else if (parsed?.payload?.message) {
    text = parsed.payload.message;  // Store the text
    image = null;                   // No image for text messages
    own = parsed.payload.clientId === clientIdRef.current;  // Is it mine?
  }
  
  // Add to the chat display
  addMessage({
    id: "some-unique-id",
    text,
    image,
    own,           // Controls styling: right-aligned if own, left if others
    at: new Date(),
  });
};
```

### How the Frontend Displays Messages

```javascript
// When rendering messages
{messages.map((m) => (
  <div className={`bubble-row ${m.own ? "own" : "other"}`}>
    {/* If image: show image, if text: show text */}
    {m.image ? (
      <img src={m.image} alt="shared" />  // Display base64 image directly
    ) : (
      m.text  // Display text message
    )}
    <span className="bubble-time">{timeLabel(m.at)}</span>
  </div>
))}
```

**CSS controls alignment:**
```css
.bubble-row.own { justify-content: flex-end; }    /* Right-aligned (mine) */
.bubble-row.other { justify-content: flex-start; } /* Left-aligned (theirs) */
```

---

## Complete Flow Diagram: Sending "hello"

```
FRONTEND (Browser Window 1)          BACKEND (Node.js)              FRONTEND (Browser Window 2)
═══════════════════════════════════════════════════════════════════════════════════════════════

User types "hello"
         ↓
[Send] button clicked
         ↓
Create JSON:
{
  type: "chat",
  payload: {
    message: "hello",
    clientId: "550e8400...",
    roomId: "blue"
  }
}
         ↓
wsRef.current.send(json)  ───────────┐
                                      ↓
                              Receive message
                                      ↓
                              Parse JSON
                                      ↓
                              Find sender's room: "blue"
                                      ↓
                              Build relay message:
                              {
                                type: "chat",
                                payload: {
                                  message: "hello",
                                  clientId: "550e8400...",
                                  roomId: "blue",
                                  image: null
                                }
                              }
                                      ↓
                              Loop through allSockets
                                      ↓
                              Find all sockets in "blue" room
                                      ↓
                          socket1.send(message) ──→ Receive JSON
                                      ↓             ↓
                          socket2.send(message) ──→ Parse JSON
                                      ↓             ↓
                                   [End]           Check clientId:
                                                   "550e8400..." === myClientId?
                                                   NO → own = false
                                                   ↓
                                                   Add to messages list
                                                   ↓
                                                   Display: "hello" (left-aligned)
```

---

## Complete Flow Diagram: Sending a Photo

```
FRONTEND (Browser)                 BACKEND (Node.js)               FRONTEND (Browser)
════════════════════════════════════════════════════════════════════════════════════

User selects photo.jpg (5MB)
         ↓
fileToCompressedDataURL(file)
  ├─ Read file as binary
  ├─ Load as Image
  ├─ Resize: 4000x3000 → 1000x750
  ├─ Draw on canvas
  └─ Convert to JPEG 70% quality
         ↓
dataUrl = "data:image/jpeg;base64,/9j/4AAQ..."  (200KB)
         ↓
Create JSON:
{
  type: "chat",
  payload: {
    image: dataUrl,        ← LARGE base64 string
    clientId: "550e8400...",
    roomId: "blue"
  }
}
         ↓
wsRef.current.send(json)  ───────────┐
                                      ↓
                              Receive (large) message
                                      ↓
                              Parse JSON
                                      ↓
                              Build relay:
                              {
                                type: "chat",
                                payload: {
                                  image: dataUrl,   ← Still base64
                                  message: "",
                                  clientId: "550e8400...",
                                  roomId: "blue"
                                }
                              }
                                      ↓
                          Relay to all in "blue" room ──→ Receive JSON
                                                           ↓
                                                           Parse JSON
                                                           ↓
                                                           Check: has image?
                                                           YES → image = dataUrl
                                                           ↓
                                                           Add to messages
                                                           ↓
                                                           Render <img src={dataUrl} />
                                                           ↓
                                                           Display photo thumbnail
```

---

## Key Concepts Explained

### 1. WebSocket vs HTTP

| HTTP | WebSocket |
|------|-----------|
| Request → Response | Persistent connection |
| One direction | Two-way communication |
| Slow (many handshakes) | Fast (connection stays open) |
| Good for: pages, images | Good for: chat, live data |

**Your app uses WebSocket because:**
- Need real-time messages
- Don't want to refresh the page
- Low latency (instant delivery)

### 2. Why We Need clientId

```javascript
// Without clientId, you can't tell who sent a message:
Message received: "hello"  // Could be me or someone else?

// With clientId, you know:
Message: "hello", clientId: "550e8400..."
if (clientId === myClientId) {
  // This is MY message, show on right
} else {
  // This is from someone else, show on left
}
```

### 3. Why We Compress Images

**Without compression:**
- Photo: 5MB
- Send to 2 people: 10MB over network
- Store in memory: 10MB
- Slow + memory hog ❌

**With compression:**
- Photo: 200KB
- Send to 2 people: 400KB over network
- Store in memory: 400KB
- Fast + efficient ✅

### 4. Base64 Encoding

Base64 converts binary data to text so it can be sent as JSON:

```
Binary photo data:
FF D8 FF E0 00 10 4A 46 49 46...

Base64 (text):
/9j/4AAQSkZJRgABA...

Why? JSON requires text strings, not binary data.
But text takes 33% more space, so we compress first.
```

### 5. Rooms (Real-time Filtering)

Backend keeps track of which users are in which room:

```javascript
// Backend's allSockets array:
[
  { socket: ws1, room: "blue",  clientId: "user1" },
  { socket: ws2, room: "blue",  clientId: "user2" },
  { socket: ws3, room: "red",   clientId: "user3" },
  { socket: ws4, room: "green", clientId: "user4" }
]

// User1 sends message in "blue" room
Backend: "Find all sockets where room === 'blue'"
Result: ws1, ws2
Action: Send message to ws1 and ws2 ONLY
```

---

## Event Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│ 1. User joins "blue" room                               │
│    Frontend → Backend: { type: "join", roomId: "blue" }│
│    Backend: Adds to allSockets array                   │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 2. User sends message or photo                         │
│    Frontend → Backend: { type: "chat", message/image } │
│    Backend: Finds sender's room                        │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Backend relays to room                              │
│    Backend → All Frontends in room: Complete message   │
│    (with clientId so they know who sent it)            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Frontend displays message                           │
│    If clientId === myId: right-aligned (mine)         │
│    Else: left-aligned (theirs)                         │
│    If has image: show <img> with base64 src           │
│    If has text: show text                              │
└─────────────────────────────────────────────────────────┘
```

---

## Testing the Flow Yourself

### Terminal 1 (Backend)
```bash
npx ts-node server.ts
```
Watch for:
```
✅ Client connected
👤 User xxx joined room: blue
📤 Chat from xxx: { hasText: true, hasImage: false }
✅ Relayed to 2 users in room: blue
```

## Architecture Summary

```
                    ┌─────────────────────┐
                    │   React Frontend    │
                    │  - React Hooks      │
                    │  - WebSocket Client │
                    │  - Image Compress   │
                    └──────────┬──────────┘
                               │
                    WebSocket  │  JSON
                 (bidirectional)
                               │
                    ┌──────────▼──────────┐
                    │  Node.js Backend    │
                    │  - WebSocket Server │
                    │  - Room Management  │
                    │  - Message Relay    │
                    └─────────────────────┘
```
