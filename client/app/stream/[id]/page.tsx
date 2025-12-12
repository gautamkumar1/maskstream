"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useParams } from "next/navigation";
import { Socket } from "socket.io-client";
import io from "socket.io-client";
import Peer, { Instance } from "simple-peer";

const SOCKET_URL = "http://localhost:4000";

interface ChatMessage {
  text: string;
  nickname: string;
  createdAt: string;
}

export default function StreamPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  // Decode and normalize streamId to ensure consistency
  const rawId = params.id as string;
  const isHost = searchParams.get("host") === "1";
  let streamId: string;
  try {
    streamId = decodeURIComponent(rawId).trim();
    // Extract just the UUID part if there's additional text
    const uuidMatch = streamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      streamId = uuidMatch[0];
    }
  } catch {
    // If decoding fails, use the raw ID (might already be decoded)
    streamId = rawId.trim();
    // Try to extract UUID from raw ID as well
    const uuidMatch = streamId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      streamId = uuidMatch[0];
    }
  }

  const [socket, setSocket] = useState<Socket | null>(null);
  const [peer, setPeer] = useState<Instance | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copied, setCopied] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const nicknameRef = useRef(`User-${Math.floor(Math.random() * 9999)}`);

  // 1. Connect socket and join room
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => {
      console.log("Socket connected:", s.id);
      s.emit("join-stream", streamId);
    });

    s.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
    });

    s.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
    });

    // Receive chat
    s.on("chat", (payload: ChatMessage) => {
      console.log("Received chat message:", payload);
      setMessages((prev) => [...prev, payload]);
    });

    return () => {
      s.disconnect();
    };
  }, [streamId]);

  // 2. Setup WebRTC peer
  useEffect(() => {
    if (!socket) return;

    const currentSocket = socket;
    let currentPeer: Instance | null = null;
    let currentStream: MediaStream | null = null;
    let signalHandler: (({ data }: { data: Peer.SignalData }) => void) | null = null;

    async function setupPeer() {
      try {
        if (isHost) {
          // HOST: get camera + create initiator peer
          console.log("Setting up host peer...");
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          currentStream = stream;

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }

          const p = new Peer({
            initiator: true,
            trickle: false,
            stream,
          });
          currentPeer = p;

          // When peer has signaling data, send via socket to viewers
          p.on("signal", (data) => {
            console.log("Host sending signal data");
            currentSocket.emit("signal", { streamId, data });
          });

          // When we receive remote stream (viewer cam if you ever do that)
          p.on("stream", (remoteStream) => {
            console.log("Host received remote stream");
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          });

          p.on("error", (err) => {
            console.error("Host peer error:", err);
          });

          p.on("connect", () => {
            console.log("Host peer connected");
          });

          // Listen to incoming signals (from viewer)
          signalHandler = ({ data }: { data: Peer.SignalData }) => {
            console.log("Host received signal from viewer");
            p.signal(data);
          };
          currentSocket.on("signal", signalHandler);

          setPeer(p);
        } else {
          // VIEWER: no need to capture camera, just receive
          console.log("Setting up viewer peer...");
          const p = new Peer({
            initiator: false,
            trickle: false,
          });
          currentPeer = p;

          p.on("signal", (data) => {
            console.log("Viewer sending signal data");
            currentSocket.emit("signal", { streamId, data });
          });

          p.on("stream", (remoteStream) => {
            console.log("Viewer received remote stream");
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          });

          p.on("error", (err) => {
            console.error("Viewer peer error:", err);
          });

          p.on("connect", () => {
            console.log("Viewer peer connected");
          });

          signalHandler = ({ data }: { data: Peer.SignalData }) => {
            console.log("Viewer received signal from host");
            p.signal(data);
          };
          currentSocket.on("signal", signalHandler);

          setPeer(p);
        }
      } catch (err) {
        console.error("Error setting up peer:", err);
      }
    }

    setupPeer();

    // Cleanup function
    return () => {
      if (signalHandler) {
        currentSocket.off("signal", signalHandler);
      }
      if (currentPeer) {
        currentPeer.destroy();
      }
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    };
  }, [socket, isHost, streamId]);

  // 3. Send chat message
  const sendChat = () => {
    if (!socket || !chatInput.trim()) return;
    
    // Verify socket is connected before sending
    if (!socket.connected) {
      console.error("Socket is not connected. Cannot send message.");
      alert("Connection lost. Please refresh the page.");
      return;
    }
    
    const message: ChatMessage = {
      text: chatInput.trim(),
      nickname: nicknameRef.current,
      createdAt: new Date().toISOString(),
    };
    
    try {
      socket.emit("chat", { streamId, message });
      setChatInput("");
      // Message will be added via the "chat" event listener
    } catch (err) {
      console.error("Error sending chat message:", err);
      alert("Failed to send message. Please try again.");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      sendChat();
    }
  };

  const getViewerUrl = () => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/stream/${streamId}`;
  };

  const handleShareUrl = async () => {
    const viewerUrl = getViewerUrl();
    
    // Try Web Share API first (mobile-friendly)
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my stream",
          text: "Join my live stream!",
          url: viewerUrl,
        });
        return;
      } catch (err) {
        // User cancelled or error, fall back to clipboard
        if ((err as Error).name !== "AbortError") {
          console.error("Error sharing:", err);
        }
      }
    }
    
    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = viewerUrl;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error("Fallback copy failed:", e);
        alert(`Please copy this URL manually: ${viewerUrl}`);
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Stream</h1>
            <div className="px-3 py-1 text-sm rounded-full bg-foreground/10 text-foreground/70">
              {streamId}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-foreground/70">
              {isHost
                ? "You are the host. Share this URL with your friends."
                : "You are a viewer. Enjoy the stream!"}
            </p>
            {isHost && (
              <button
                onClick={handleShareUrl}
                className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg font-medium text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                    </svg>
                    Share URL
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video Section */}
          <div className="lg:col-span-2 space-y-4">
            {isHost && (
              <div className="space-y-2">
                <h2 className="text-sm font-medium text-foreground/70">
                  Your Camera
                </h2>
                <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-foreground/70">
                {isHost ? "Remote Stream" : "Live Stream"}
              </h2>
              <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                {!remoteVideoRef.current?.srcObject && (
                  <div className="absolute inset-0 flex items-center justify-center text-foreground/50">
                    <div className="text-center space-y-2">
                      <div className="w-16 h-16 mx-auto border-2 border-foreground/20 rounded-full animate-pulse" />
                      <p>Waiting for stream...</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chat Section */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Chat</h2>
            <div className="flex flex-col h-[calc(100vh-300px)] min-h-[400px] bg-foreground/5 rounded-lg border border-foreground/10 overflow-hidden">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="text-center text-foreground/50 py-8">
                    <p>No messages yet</p>
                    <p className="text-sm mt-1">Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-foreground/90">
                          {msg.nickname || "Anon"}
                        </span>
                        <span className="text-xs text-foreground/50">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/80">{msg.text}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-foreground/10">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 bg-background border border-foreground/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-transparent"
                  />
                  <button
                    onClick={sendChat}
                    disabled={!chatInput.trim()}
                    className="px-6 py-2 bg-foreground text-background rounded-lg font-medium text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
