import type { ProjectFileEntry } from "@orbs/protocol";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils.ts";

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  isFile: boolean;
}

function buildTree(entries: ProjectFileEntry[]): Node {
  const root: Node = { name: "", path: "", children: new Map(), isFile: false };
  for (const { path } of entries) {
    let node = root;
    const parts = path.split("/");
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: parts.slice(0, index + 1).join("/"), children: new Map(), isFile };
        node.children.set(part, child);
      }
      node = child;
    });
  }
  return root;
}

function sortedChildren(node: Node) {
  return [...node.children.values()].sort((a, b) =>
    a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1,
  );
}

function TreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: Node;
  depth: number;
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = { paddingLeft: `${depth * 12 + 8}px` };
  if (node.isFile) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        style={indent}
        className={cn(
          "flex w-full items-center gap-1.5 truncate rounded py-0.5 pr-2 text-left text-[13px] hover:bg-muted",
          selected === node.path && "bg-accent font-medium",
        )}
      >
        <File className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={indent}
        className="flex w-full items-center gap-1 truncate rounded py-0.5 pr-2 text-left text-[13px] hover:bg-muted"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <Folder className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">{node.name}</span>
      </button>
      {open &&
        sortedChildren(node).map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </div>
  );
}

export function FileTree({
  entries,
  selected,
  onSelect,
}: {
  entries: ProjectFileEntry[];
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const root = useMemo(() => buildTree(entries), [entries]);
  return (
    <div className="space-y-px">
      {sortedChildren(root).map((child) => (
        <TreeNode key={child.path} node={child} depth={0} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}
