export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div class="overflow-x-auto max-h-80 overflow-y-auto border border-line rounded">
      <table class="text-xs w-full">
        <thead class="sticky top-0 bg-bg-3">
          <tr>{columns.map((c) => <th key={c} class="text-left px-2 py-1 font-semibold text-fg-2">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} class="odd:bg-bg-2">
              {r.map((v, j) => <td key={j} class={`px-2 py-1 ${j > 0 ? 'tabular-nums' : ''}`}>{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
