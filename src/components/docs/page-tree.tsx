import Link from "next/link";
export function DocPageTree({ pages, currentId }: { pages: { id: string; parentId: string | null; title: string; controlled: boolean }[]; currentId?: string }) {
  function branch(parentId: string | null, visited: Set<string>, depth = 0) {
    if (depth > 24) return null;
    const children = pages.filter(p => p.parentId === parentId && !visited.has(p.id));
    return children.length ? <ul className={depth ? "ml-3 border-l border-slate-700 pl-3" : "space-y-1"}>{children.map(p => <li key={p.id} className="py-1">
      <Link href={`/docs/pages/${p.id}`} aria-current={currentId === p.id ? "page" : undefined} className={`block rounded px-2 py-1 text-sm hover:bg-slate-800 ${currentId === p.id ? "bg-teal-950 text-teal-300" : "text-slate-300"}`}>{p.controlled ? "▣ " : "▤ "}{p.title}</Link>
      {branch(p.id, new Set([...visited, p.id]), depth + 1)}
    </li>)}</ul> : null;
  }
  return <nav aria-label="Page tree">{branch(null, new Set()) ?? <p className="text-sm text-slate-500">No pages yet.</p>}</nav>;
}
