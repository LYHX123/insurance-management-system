export function TableWrap({
  scroll = false,
  className = "",
  children,
}: {
  scroll?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`table-wrap ${scroll ? "table-scroll" : ""} ${className}`.trim()}>
      {children}
    </div>
  );
}

export function Table({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <table className={`table ${className}`.trim()}>{children}</table>;
}

export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-zinc-400">
        {children}
      </td>
    </tr>
  );
}
