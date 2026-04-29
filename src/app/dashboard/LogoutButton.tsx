"use client";

import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <button
      onClick={handleLogout}
      style={{
        background: "rgba(255,255,255,0.08)",
        color: "#f0efe8",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "10px",
        padding: "10px 20px",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      ログアウト
    </button>
  );
}
