import { useState } from "react";
import { GripVertical, Lock } from "lucide-react";
import type { ColumnDef } from "@/hooks/useColumnOrder";

interface Props {
  columns: ColumnDef[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onReset: () => void;
}

export function DraggableColumnSelector({ columns, isVisible, onToggle, onReorder, onReset }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div className="py-1">
      {columns.map((col, index) => (
        <div
          key={col.id}
          draggable
          onDragStart={(e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = "move";
            // Required for Firefox
            e.dataTransfer.setData("text/plain", col.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragIndex !== null && index !== dragOverIndex) {
              setDragOverIndex(index);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex !== null && dragIndex !== index) {
              onReorder(dragIndex, index);
            }
            setDragIndex(null);
            setDragOverIndex(null);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setDragOverIndex(null);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors select-none ${
            dragOverIndex === index && dragIndex !== null && dragIndex !== index
              ? "border-t-2 border-primary bg-primary/5"
              : "border-t-2 border-transparent"
          } ${dragIndex === index ? "opacity-30" : "hover:bg-secondary/50"}`}
          style={{ cursor: "grab" }}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          {col.alwaysOn ? (
            <div className="flex items-center gap-2 flex-1 opacity-70">
              <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] text-muted-foreground">{col.label}</span>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer flex-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isVisible(col.id)}
                onChange={() => onToggle(col.id)}
                className="h-3.5 w-3.5 rounded cursor-pointer accent-[hsl(var(--primary))]"
              />
              <span className="text-[11px] text-foreground">{col.label}</span>
            </label>
          )}
        </div>
      ))}
      <div className="border-t border-border mx-2 mt-1 pt-1">
        <button
          onClick={onReset}
          className="w-full px-2.5 py-1.5 text-left text-[11px] text-primary hover:text-primary/80 transition-colors"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
