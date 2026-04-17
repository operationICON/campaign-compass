import { useState, forwardRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface RefreshButtonProps {
  queryKeys: string[];
}

export const RefreshButton = forwardRef<HTMLButtonElement, RefreshButtonProps>(
  function RefreshButton({ queryKeys }, ref) {
    const queryClient = useQueryClient();
    const [spinning, setSpinning] = useState(false);

    const handleRefresh = async () => {
      setSpinning(true);
      await Promise.all(queryKeys.map(k => queryClient.invalidateQueries({ queryKey: [k] })));
      setTimeout(() => {
        setSpinning(false);
        toast.success("Updated", { duration: 2000 });
      }, 1000);
    };

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            onClick={handleRefresh}
            disabled={spinning}
            className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${spinning ? "animate-spin" : ""}`} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Refresh data</TooltipContent>
      </Tooltip>
    );
  }
);
