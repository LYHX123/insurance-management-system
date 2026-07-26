export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "purple"
  | "teal";

const toneClass: Record<BadgeTone, string> = {
  neutral: "badge-neutral",
  brand: "badge-brand",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  purple: "badge-purple",
  teal: "badge-teal",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={`${toneClass[tone]} ${className}`.trim()}>{children}</span>;
}
