import { useState, useCallback, useMemo } from "react";

export interface ColumnDef {
  id: string;
  label: string;
  defaultOn: boolean;
  alwaysOn?: boolean;
}

export function useColumnOrder(storageKey: string, columns: ColumnDef[]) {
  const defaultOrder = columns.map(c => c.id);
  const defaultVisibility: Record<string, boolean> = {};
  columns.forEach(c => { defaultVisibility[c.id] = c.defaultOn || c.alwaysOn || false; });

  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey + "_order");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const set = new Set(parsed);
        const validIds = new Set(columns.map(c => c.id));
        // Add new columns not in saved order
        columns.forEach(c => { if (!set.has(c.id)) parsed.push(c.id); });
        return parsed.filter(id => validIds.has(id));
      }
    } catch {}
    return defaultOrder;
  });

  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(storageKey + "_vis");
      if (saved) {
        const parsed = JSON.parse(saved);
        columns.forEach(c => { if (c.alwaysOn) parsed[c.id] = true; });
        return { ...defaultVisibility, ...parsed };
      }
      // Migrate old visibility-only key if it exists
      const oldVis = localStorage.getItem(storageKey);
      if (oldVis) {
        const parsed = JSON.parse(oldVis);
        columns.forEach(c => { if (c.alwaysOn) parsed[c.id] = true; });
        return { ...defaultVisibility, ...parsed };
      }
    } catch {}
    return defaultVisibility;
  });

  const toggleColumn = useCallback((id: string) => {
    const col = columns.find(c => c.id === id);
    if (col?.alwaysOn) return;
    setVisibility(prev => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(storageKey + "_vis", JSON.stringify(next));
      return next;
    });
  }, [columns, storageKey]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      localStorage.setItem(storageKey + "_order", JSON.stringify(next));
      return next;
    });
  }, [storageKey]);

  const isVisible = useCallback((id: string) => visibility[id] ?? false, [visibility]);

  const orderedColumns = useMemo(() => {
    return order
      .map(id => columns.find(c => c.id === id))
      .filter(Boolean) as ColumnDef[];
  }, [order, columns]);

  const visibleOrderedColumns = useMemo(() => {
    return orderedColumns.filter(c => visibility[c.id]);
  }, [orderedColumns, visibility]);

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey + "_order");
    localStorage.removeItem(storageKey + "_vis");
    localStorage.removeItem(storageKey); // remove old key too
    setOrder(defaultOrder);
    setVisibility(defaultVisibility);
  }, [storageKey, defaultOrder, defaultVisibility]);

  return {
    orderedColumns,
    visibleOrderedColumns,
    isVisible,
    toggleColumn,
    reorder,
    reset,
  };
}
