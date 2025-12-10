import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuid } from "uuid";
import { pool } from "./utils/db";

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN,
  credentials: true,
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN,
  },
});

// HTTP route: create a new stream
app.post("/streams", async (req, res) => {
  try {
    const id = uuid();
    await pool.query("INSERT INTO streams (id) VALUES ($1)", [id]);
    res.json({ streamId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create stream" });
  }
});

// Optional: check if stream exists
app.get("/streams/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT id FROM streams WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ exists: false });
    }
    res.json({ exists: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to check stream" });
  }
});

// --- Socket.io events for signaling + chat ---
io.on("connection", (socket) => {
  console.log("New socket connected:", socket.id);

  // Join a room for a particular stream
  socket.on("join-stream", (streamId: string) => {
    socket.join(streamId);
    console.log(`Socket ${socket.id} joined stream ${streamId}`);
  });

  // WebRTC signaling messages
  socket.on("signal", ({ streamId, data }: { streamId: string; data: any }) => {
    // Send to everyone else in the same room
    socket.to(streamId).emit("signal", {
      from: socket.id,
      data,
    });
  });

  // Chat messages
  socket.on("chat", ({ streamId, message }: { streamId: string; message: string }) => {
    // Broadcast to everyone in the same room
    io.to(streamId).emit("chat", {
      from: socket.id,
      message,
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await pool.connect();
  console.log("Connected to Postgres");
});