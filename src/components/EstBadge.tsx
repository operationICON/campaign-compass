import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EstBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground leading-none">Est.</span>
      </TooltipTrigger>
      <TooltipContent>Calculated from Revenue (estimate). LTV data not available.</TooltipContent>
    </Tooltip>
  );
}
