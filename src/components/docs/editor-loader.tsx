"use client";
import dynamic from "next/dynamic";
import type { DocEditorProps } from "./editor";
const Editor = dynamic(() => import("./editor"), { ssr: false, loading: () => <p className="p-6 text-slate-500">Loading editor…</p> });
export function DocEditorLoader(props: DocEditorProps) { return <Editor {...props} />; }
