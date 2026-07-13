import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className = "", children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={`select ${className}`.trim()} {...props}>
      {children}
    </select>
    <ChevronDown
      size={16}
      className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-400"
    />
  </div>
));
Select.displayName = "Select";
