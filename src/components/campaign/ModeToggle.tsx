"use client";

import { createClient } from "@/lib/supabase/client";

type Props = {
  campaignId: string;
  autoMode: boolean;
  onToggle: (newMode: boolean) => void;
};

export default function ModeToggle({ campaignId, autoMode, onToggle }: Props) {
  const handleToggle = async () => {
    const newMode = !autoMode;
    const supabase = createClient();
    await supabase.from("campaigns").update({ auto_mode: newMode }).eq("id", campaignId);
    onToggle(newMode);
  };

  return (
    <button onClick={handleToggle} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 20px", background: autoMode ? "rgba(45,209,122,0.1)" : "rgba(255,107,53,0.1)", border: `1px solid ${autoMode ? "rgba(45,209,122,0.3)" : "rgba(255,107,53,0.3)"}`, borderRadius: "12px", cursor: "pointer", transition: "all 0.2s" }}>
      <span style={{ fontSize: "16px" }}>{autoMode ? "🟢" : "🔶"}</span>
      <span style={{ fontSize: "14px", fontWeight: 600, color: autoMode ? "#2dd17a" : "#ff6b35" }}>
        {autoMode ? "全自動" : "半自動"}
      </span>
    </button>
  );
}
