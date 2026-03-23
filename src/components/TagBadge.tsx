import { useQuery } from "@tanstack/react-query";
import { fetchSourceTagRules } from "@/lib/supabase-helpers";

interface TagBadgeProps {
  tagName: string | null | undefined;
  size?: "sm" | "md";
}

export function useTagColors() {
  const { data: rules = [] } = useQuery({
    queryKey: ["source_tag_rules"],
    queryFn: fetchSourceTagRules,
    staleTime: 60_000,
  });

  const colorMap: Record<string, string> = {};
  rules.forEach((r: any) => {
    colorMap[r.tag_name] = r.color;
  });
  return colorMap;
}

export function TagBadge({ tagName, size = "sm" }: TagBadgeProps) {
  const colorMap = useTagColors();

  if (!tagName || tagName === "Untagged") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
        <span className={`italic text-muted-foreground ${size === "sm" ? "text-[11px]" : "text-xs"}`}>Untagged</span>
      </span>
    );
  }

  const color = colorMap[tagName] || "#94a3b8";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className={`text-foreground ${size === "sm" ? "text-[11px]" : "text-xs"} font-medium`}>{tagName}</span>
    </span>
  );
}
