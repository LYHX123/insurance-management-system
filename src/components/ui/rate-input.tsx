import { forwardRef } from "react";
import { Input } from "./input";

// Shared input for every percentage/rate field in the Quotation module
// (CAR/CPM/TPL/WIBA/PL/Fire/PVT/Burglary/GIT/Marine/Motor/GPA/Guarantee/
// Customs Bond rates, and any future one). Sets the decimal step/min
// defaults rate fields need; spinner arrows are removed globally for every
// <input type="number"> via globals.css, not by the "rate-input" class
// itself (kept here only as a styling hook, not a spinner rule).
export const RateInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ className = "", step = "0.0001", min = "0", ...props }, ref) => (
    <Input ref={ref} type="number" step={step} min={min} className={`rate-input ${className}`.trim()} {...props} />
  )
);
RateInput.displayName = "RateInput";
