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

// Store the latest offer for each stream
const streamOffers = new Map<string, any>();

// --- Socket.io events for signaling + chat ---
io.on("connection", (socket) => {
  console.log("New socket connected:", socket.id);
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:71',message:'New socket connected',data:{socketId: socket.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Join a room for a particular stream
  socket.on("join-stream", (streamId: string) => {
    // Normalize streamId: decode URL encoding and trim whitespace
    let normalizedStreamId: string;
    try {
      normalizedStreamId = decodeURIComponent(streamId).trim();
      // Extract just the UUID part if there's additional text
      const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) {
        normalizedStreamId = uuidMatch[0];
      }
    } catch {
      // If decoding fails, use the streamId as-is (might already be decoded)
      normalizedStreamId = streamId.trim();
      // Try to extract UUID from raw ID as well
      const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) {
        normalizedStreamId = uuidMatch[0];
      }
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:87',message:'Joining stream room',data:{socketId: socket.id, originalStreamId: streamId, normalizedStreamId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    socket.join(normalizedStreamId);
    console.log(`Socket ${socket.id} joined stream ${normalizedStreamId} (original: ${streamId})`);
    
    // Check if there's already a host in this room
    const socketsInRoom = io.sockets.adapter.rooms.get(normalizedStreamId);
    const socketCount = socketsInRoom ? socketsInRoom.size : 0;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:98',message:'Successfully joined stream room',data:{socketId: socket.id, normalizedStreamId, socketCount},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Check if this is a viewer joining after a host is already in the room
    if (socketCount > 1) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:103',message:'Viewer joining existing stream',data:{socketId: socket.id, normalizedStreamId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // Check if there's a stored offer for this stream
      const storedOffer = streamOffers.get(normalizedStreamId);
      if (storedOffer) {
        // Send the stored offer to the new viewer
        socket.emit("signal", { data: storedOffer });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:109',message:'Sent stored offer to new viewer',data:{socketId: socket.id, normalizedStreamId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      }
      
      // Notify existing host that a new viewer has joined
      socket.to(normalizedStreamId).emit("viewer-joined", { viewerId: socket.id });
    }
  });

  // WebRTC signaling messages
  socket.on("signal", ({ streamId, data }: { streamId: string; data: any }) => {
    try {
      // Normalize streamId: decode URL encoding and trim whitespace
      let normalizedStreamId: string;
      try {
        normalizedStreamId = decodeURIComponent(streamId).trim();
        // Extract just the UUID part if there's additional text
        const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
          normalizedStreamId = uuidMatch[0];
        }
      } catch {
        // If decoding fails, use the streamId as-is (might already be decoded)
        normalizedStreamId = streamId.trim();
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:115',message:'Received signal',data:{socketId: socket.id, originalStreamId: streamId, normalizedStreamId, signalType: data.type},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // Store the latest offer from the host
      if (data.type === "offer") {
        streamOffers.set(normalizedStreamId, data);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:121',message:'Stored offer signal for stream',data:{socketId: socket.id, normalizedStreamId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      }
      
      console.log(`Signal from ${socket.id} in stream ${normalizedStreamId}`);
      // Send to everyone else in the same room (excluding sender)
      socket.to(normalizedStreamId).emit("signal", { data });
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:127',message:'Relayed signal to room',data:{socketId: socket.id, normalizedStreamId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      console.error("Error handling signal:", err);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:131',message:'Error handling signal',data:{socketId: socket.id, error: err instanceof Error ? err.message : 'Unknown error'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  });

  // Handle offer request from viewer
  socket.on("request-offer", ({ streamId }: { streamId: string }) => {
    // Normalize streamId: decode URL encoding and trim whitespace
    let normalizedStreamId: string;
    try {
      normalizedStreamId = decodeURIComponent(streamId).trim();
      // Extract just the UUID part if there's additional text
      const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) {
        normalizedStreamId = uuidMatch[0];
      }
    } catch {
      // If decoding fails, use the streamId as-is (might already be decoded)
      normalizedStreamId = streamId.trim();
      // Try to extract UUID from raw ID as well
      const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) {
        normalizedStreamId = uuidMatch[0];
      }
    }
    
    // Check if there's a stored offer for this stream
    const storedOffer = streamOffers.get(normalizedStreamId);
    if (storedOffer) {
      // Send stored offer to requesting viewer
      socket.emit("signal", { data: storedOffer });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/5f680115-6a97-4a14-b858-6f5da8c067df',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:165',message:'Sent stored offer on request',data:{socketId: socket.id, normalizedStreamId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  });

  // Chat messages
  socket.on("chat", ({ streamId, message }: { streamId: string; message: { text: string; nickname: string; createdAt: string } }) => {
    try {
      // Normalize streamId: decode URL encoding and trim whitespace
      let normalizedStreamId: string;
      try {
        normalizedStreamId = decodeURIComponent(streamId).trim();
        // Extract just the UUID part if there's additional text
        const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
          normalizedStreamId = uuidMatch[0];
        }
      } catch {
        // If decoding fails, use the streamId as-is (might already be decoded)
        normalizedStreamId = streamId.trim();
        // Try to extract UUID from raw ID as well
        const uuidMatch = normalizedStreamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
          normalizedStreamId = uuidMatch[0];
        }
      }
      console.log(`Chat message from ${socket.id} in stream ${normalizedStreamId} (original: ${streamId}):`, message.text);
      // Ensure socket is in the room before broadcasting
      if (!socket.rooms.has(normalizedStreamId)) {
        socket.join(normalizedStreamId);
        console.log(`Socket ${socket.id} joined stream ${normalizedStreamId} via chat message`);
      }
      // Broadcast to everyone in the same room (including sender)
      io.to(normalizedStreamId).emit("chat", message);
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