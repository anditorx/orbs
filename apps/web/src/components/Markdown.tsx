import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils.ts";

/**
 * Renders a model's reply. Replies are untrusted text: raw HTML in them is not rendered (react-markdown turns it
 * into plain text), unsafe link schemes are dropped, links open in a new tab without leaking the page, and images
 * are shown as their alt text so a reply can't make the browser fetch a remote address.
 */
const components: Components = {
  a: ({ href, children }) =>
    !href ? (
      // An unsafe address (such as a script link) is dropped by the renderer; keep the words, not a dead link.
      <span>{children}</span>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ),
  img: ({ alt }) => <span className="italic text-muted-foreground">{alt || "image"}</span>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => <h5 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h5>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-background/60 p-3 text-xs leading-relaxed ring-1 ring-border">
      {children}
    </pre>
  ),
  code: ({ className, children, ...rest }: ComponentProps<"code">) => (
    // Fenced code arrives with a language class (or inside <pre>); inline code gets the pill style.
    <code
      className={cn(
        className
          ? "font-mono"
          : "rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em] ring-1 ring-border",
        className,
      )}
      {...rest}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-background/40 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
