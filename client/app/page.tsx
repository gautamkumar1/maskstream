"use client";

import { useState } from "react";

export default function HomePage() {
  const [loading, setLoading] = useState(false);

  const handleStartStreaming = async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:4000/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      // Check if response is OK before parsing
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Stream creation failed:", res.status, errorData);
        alert(`Failed to create stream: ${errorData.error || "Server error"}`);
        return;
      }

      const data = await res.json();
      const streamId = data.streamId;

      // Validate streamId exists before redirecting
      if (!streamId) {
        console.error("No streamId in response:", data);
        alert("Failed to create stream: Invalid response from server");
        return;
      }

      // Redirect as host
      window.location.href = `/stream/${streamId}?host=1`;
    } catch (err) {
      console.error("Error creating stream:", err);
      alert("Failed to create stream. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight">
            Mask Stream
          </h1>
          <p className="text-lg text-foreground/70">
            No account. Click once and go live.
          </p>
        </div>
        
        <button
          onClick={handleStartStreaming}
          disabled={loading}
          className="w-full px-8 py-4 bg-foreground text-background rounded-lg font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Starting..." : "Start Streaming"}
        </button>
      </div>
    </main>
  );
}
