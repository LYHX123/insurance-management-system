import { forwardRef } from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "default" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ tone = "default", className = "", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`btn-icon ${tone === "danger" ? "hover:bg-red-50 hover:text-red-600" : ""} ${className}`.trim()}
      {...props}
    />
  )
);
IconButton.displayName = "IconButton";
