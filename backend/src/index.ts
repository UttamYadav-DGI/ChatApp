import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({ port: 8080 });

interface User {
  socket: WebSocket;
  room: string;
  clientId: string;
}

let allSockets: User[] = [];

wss.on("connection", function (socket) {
  console.log("✅ Client connected");
  socket.send(JSON.stringify({ type: "system", message: "Connected to server" }));

  socket.on("message", (message) => {
    try {
      const ParsedMessage = JSON.parse(message.toString());
      console.log("📨 Received:", ParsedMessage.type);

      if (ParsedMessage.type === "join") {
        // Remove user from any previous room (reconnect handling)
        allSockets = allSockets.filter((u) => u.socket !== socket);

        // Add to new room
        allSockets.push({
          socket,
          room: ParsedMessage.payload.roomId,
          clientId: ParsedMessage.payload.clientId,
        });

        console.log(
          `👤 User ${ParsedMessage.payload.clientId} joined room: ${ParsedMessage.payload.roomId}`
        );
        console.log(`📊 Total connections: ${allSockets.length}`);
      }

      if (ParsedMessage.type === "chat") {
        let currentUserRoom = null;
        let currentClientId = ParsedMessage.payload.clientId;

        // Find the sender's room
        for (let i = 0; i < allSockets.length; i++) {
          if (allSockets[i]?.socket === socket) {
            currentUserRoom = allSockets[i]?.room;
            break;
          }
        }

        if (!currentUserRoom) {
          console.log("⚠️ User not in a room, ignoring message");
          return;
        }

        // Build the complete message to relay (includes text OR image + clientId)
        const messageToRelay = JSON.stringify({
          type: "chat",
          payload: {
            message: ParsedMessage.payload.message || "",
            image: ParsedMessage.payload.image || null,
            clientId: currentClientId,
            roomId: currentUserRoom,
          },
        });
console.log("messs",messageToRelay)
        // Send to all users in the same room
        let sentCount = 0;
        for (let i = 0; i < allSockets.length; i++) {
          if (allSockets[i]?.room === currentUserRoom) {
            allSockets[i]?.socket.send(messageToRelay);
            sentCount++;
          }
        }

        console.log(
          `📤 Message relayed to ${sentCount} users in room: ${currentUserRoom}`
        );
      }
    } catch (error) {
      console.error("❌ Error parsing message:", error);
    }
  });

  socket.on("close", () => {
    allSockets = allSockets.filter((u) => u.socket !== socket);
    console.log(`❌ Client disconnected. Connections: ${allSockets.length}`);
  });

  socket.on("error", (error) => {
    console.error("❌ Socket error:", error);
  });
});

console.log("🚀 WebSocket server running on ws://localhost:8080");