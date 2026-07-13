import { Badge } from "@/components/ui/badge";

export function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <Badge tone={active ? "success" : "neutral"}>
      {active ? activeLabel : inactiveLabel}
    </Badge>
  );
}
