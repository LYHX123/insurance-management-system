import { forwardRef } from "react";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = "", rows = 3, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={`textarea ${className}`.trim()} {...props} />
));
Textarea.displayName = "Textarea";
