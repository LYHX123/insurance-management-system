export function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="form-label">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-secondary">{hint}</p>}
    </div>
  );
}
