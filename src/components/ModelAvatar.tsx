const MODEL_COLORS: Record<string, string> = {
  j: "#e11d48", m: "#0891b2", z: "#7c3aed", e: "#ea580c", a: "#2563eb",
  s: "#16a34a", d: "#9333ea", r: "#dc2626", k: "#0d9488", l: "#c026d3",
  f: "#f59e0b", b: "#6366f1",
};

function getColor(name: string) {
  const first = (name || "?").replace("@", "").charAt(0).toLowerCase();
  return MODEL_COLORS[first] || "#6b7280";
}

interface ModelAvatarProps {
  avatarUrl?: string | null;
  name: string;
  size?: number;
  className?: string;
}

export function ModelAvatar({ avatarUrl, name, size = 24, className = "" }: ModelAvatarProps) {
  const initial = (name || "?").replace("@", "").charAt(0).toUpperCase();
  const bg = getColor(name);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, minWidth: size, backgroundColor: avatarUrl ? "transparent" : bg }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-full h-full object-cover rounded-full"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.style.backgroundColor = bg;
              parent.textContent = initial;
              parent.style.color = "white";
              parent.style.fontSize = `${Math.round(size * 0.4)}px`;
              parent.style.fontWeight = "700";
            }
          }}
        />
      ) : (
        <span style={{ color: "white", fontSize: Math.round(size * 0.4), fontWeight: 700 }}>{initial}</span>
      )}
    </span>
  );
}
