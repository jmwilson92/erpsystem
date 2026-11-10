"use client";
import { useEffect, useState, useActionState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { actionSaveDocPage } from "@/app/docs/actions";
import { safeDocHref } from "@/lib/docs/content";

export type DocEditorProps = {
  page: { id: string; title: string; content: string; version: number; controlled: boolean; isTemplate: boolean; parentId: string | null; status: string };
  parents: { id: string; title: string }[];
};
export default function DocEditor({ page, parents }: DocEditorProps) {
  const [content, setContent] = useState(page.content);
  const [dirty, setDirty] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [state, dispatch, pending] = useActionState(async (previous: { error?: string; ok?: boolean }, data: FormData) => {
    setDirty(false);
    try {
      const result = await actionSaveDocPage(previous, data);
      if (result.error) setDirty(true);
      return result;
    } catch (error) { setDirty(true); throw error; }
  }, {});
  const editor = useEditor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, protocols: ["http", "https"] } })], content: JSON.parse(page.content), immediatelyRender: false,
    editorProps: { attributes: { "aria-label": "Page content", class: "focus:outline-none" } },
    onUpdate: ({ editor }) => { setContent(JSON.stringify(editor.getJSON())); setDirty(true); },
  });
  const active = useEditorState({ editor, selector: ({ editor: e }) => ({ bold: e?.isActive("bold"), italic: e?.isActive("italic"), strike: e?.isActive("strike"), underline: e?.isActive("underline"), h2: e?.isActive("heading", { level: 2 }), bullet: e?.isActive("bulletList"), ordered: e?.isActive("orderedList"), code: e?.isActive("codeBlock"), quote: e?.isActive("blockquote") }) });
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const controls = [
    { label: "Bold", text: "B", active: active?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Italic", text: "I", active: active?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { label: "Underline", text: "U", active: active?.underline, run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: "Strikethrough", text: "S̶", active: active?.strike, run: () => editor?.chain().focus().toggleStrike().run() },
    { label: "Heading", text: "H2", active: active?.h2, run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Bullet list", text: "• List", active: active?.bullet, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", text: "1. List", active: active?.ordered, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: "Quote", text: "Quote", active: active?.quote, run: () => editor?.chain().focus().toggleBlockquote().run() },
    { label: "Code block", text: "</>", active: active?.code, run: () => editor?.chain().focus().toggleCodeBlock().run() },
  ];
  return <form action={dispatch} className="space-y-4" onChange={() => setDirty(true)}>
    <input type="hidden" name="id" value={page.id} /><input type="hidden" name="version" value={page.version} /><input type="hidden" name="content" value={content} />
    {page.status === "RELEASED" ? <p className="rounded-lg border border-amber-700 p-3 text-sm text-amber-300">Saving creates a new draft. The previously signed revision and its signature remain immutable in history.</p> : null}
    <label className="block text-sm">Page title<Input name="title" defaultValue={page.title} required maxLength={180} /></label>
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/30">
      <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap gap-1 border-b border-slate-700 p-2">{controls.map(c => <button type="button" key={c.label} title={c.label} aria-label={c.label} aria-pressed={!!c.active} disabled={!editor} onClick={c.run} className={`rounded px-3 py-1.5 text-sm ${c.active ? "bg-teal-900 text-teal-200" : "hover:bg-slate-800"}`}>{c.text}</button>)}
        <button type="button" className="rounded px-3 py-1.5 text-sm hover:bg-slate-800" onClick={() => { const href = window.prompt("Link URL (https://… or /docs/pages/…)", String(editor?.getAttributes("link").href ?? "")); if (href === null) return; if (!href) { editor?.chain().focus().unsetLink().run(); return; } const safe = safeDocHref(href); if (!safe) { setLinkError("Use an https:// URL or an internal /path."); return; } setLinkError(""); editor?.chain().focus().extendMarkRange("link").setLink({ href: safe }).run(); }}>Link</button>
        <button type="button" className="rounded px-3 py-1.5 text-sm hover:bg-slate-800" onClick={() => editor?.chain().focus().undo().run()}>Undo</button><button type="button" className="rounded px-3 py-1.5 text-sm hover:bg-slate-800" onClick={() => editor?.chain().focus().redo().run()}>Redo</button>
      </div>
      {linkError ? <p role="alert" className="p-2 text-sm text-rose-400">{linkError}</p> : null}
      {editor ? <EditorContent editor={editor} className="docs-prose" /> : <p className="p-6 text-slate-500">Loading editor…</p>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Parent page<select name="parentId" defaultValue={page.parentId ?? ""} className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-2"><option value="">Top level</option>{parents.filter(p => p.id !== page.id).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label className="text-sm">Change summary<Input name="summary" placeholder="What changed?" maxLength={500} /></label></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="controlled" defaultChecked={page.controlled} />Controlled document</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isTemplate" defaultChecked={page.isTemplate} />Reusable page template</label>
    {state.error ? <p role="alert" className="rounded border border-rose-800 p-3 text-sm text-rose-300">{state.error}</p> : null}
    <Button disabled={pending || !editor}>{pending ? "Saving…" : "Save new version"}</Button><span className="ml-3 text-xs text-slate-500">Editing v{page.version}. No silent overwrite.</span>
  </form>;
}
