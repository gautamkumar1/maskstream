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
    console.log("Creating stream with ID:", id);
    
    // Check database connection
    const client = await pool.connect();
    try {
      await client.query("INSERT INTO streams (id) VALUES ($1)", [id]);
      console.log("Stream created successfully:", id);
      res.json({ streamId: id });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error creating stream:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ 
      error: "Failed to create stream",
      details: process.env.NODE_ENV === "development" ? errorMessage : undefined
    });
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
    console.error("Error checking stream:", err);
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
    try {
      console.log(`Signal from ${socket.id} in stream ${streamId}`);
      // Send to everyone else in the same room (excluding sender)
      socket.to(streamId).emit("signal", { data });
    } catch (err) {
      console.error("Error handling signal:", err);
    }
  });

  // Chat messages
  socket.on("chat", ({ streamId, message }: { streamId: string; message: { text: string; nickname: string; createdAt: string } }) => {
    try {
      console.log(`Chat message from ${socket.id} in stream ${streamId}:`, message.text);
      // Broadcast to everyone in the same room (including sender)
      io.to(streamId).emit("chat", message);
    } catch (err) {
      console.error("Error handling chat message:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Initialize database - ensure streams table exists
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS streams (
          id UUID PRIMARY KEY
        )
      `);
      console.log("Database initialized: streams table ready");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Failed to initialize database:", err);
    throw err;
  }
}

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  try {
    await initializeDatabase();
    console.log("Connected to Postgres");
  } catch (err) {
    console.error("Database initialization failed. Please check your DATABASE_URL and ensure PostgreSQL is running.");
    process.exit(1);
  }
});