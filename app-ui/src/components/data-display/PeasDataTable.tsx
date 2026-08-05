import type { ReactNode } from "react";

export interface PeasDataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

interface PeasDataTableProps<T> {
  columns: Array<PeasDataTableColumn<T>>;
  rows: T[];
  getRowKey: (row: T) => string | number;
  emptyState?: ReactNode;
}

export function PeasDataTable<T>({ columns, rows, getRowKey, emptyState }: PeasDataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="peas-data-table-wrap">
      <table className="peas-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.className} key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td className={column.className} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
