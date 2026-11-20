"use client";
// SPDX-License-Identifier: MIT


import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  /** Explicit breadcrumb items. Ignored when `path` is provided. */
  items?: BreadcrumbItem[];
  /** A URL pathname (e.g. "/batches/batch-payouts") to derive items from. */
  path?: string;
  className?: string;
}

/** Hex strings (optionally 0x-prefixed) of 16+ chars, or 56-char Stellar G-addresses. */
const ID_SEGMENT = /^(?:(?:0x)?[0-9a-f]{16,}|G[A-Z0-9]{55})$/i;

/**
 * Turn a raw route segment into a readable label: URI-decodes it
 * ("batch%20payouts" -> "batch payouts"), converts slugs to Title Case
 * ("batch-payouts" -> "Batch Payouts") and shortens long hex/hash IDs.
 */
export function formatSegmentLabel(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed escape sequence: fall back to the raw segment.
  }

  if (ID_SEGMENT.test(decoded)) {
    return decoded.length > 12 ? `${decoded.slice(0, 6)}…${decoded.slice(-4)}` : decoded;
  }

  return decoded
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Build breadcrumb items from a pathname. The last item has no href. */
export function breadcrumbItemsFromPath(path: string): BreadcrumbItem[] {
  const clean = path.split(/[?#]/)[0];
  const segments = clean.split("/").filter(Boolean);
  return segments.map((segment, i) => ({
    label: formatSegmentLabel(segment),
    href: i === segments.length - 1 ? undefined : "/" + segments.slice(0, i + 1).join("/"),
  }));
}

/**
 * Breadcrumb navigation showing the current page path.
 * Home link is automatically prepended.
 */
export function Breadcrumb({ items, path, className }: BreadcrumbProps) {
  if (path !== undefined) {
    return <PathBreadcrumb path={path} className={className} />;
  }
  return <BreadcrumbView items={items ?? []} className={className} />;
}

function PathBreadcrumb({ path, className }: { path: string; className?: string }) {
  const router = useRouter();
  return (
    <BreadcrumbView
      items={breadcrumbItemsFromPath(path)}
      className={className}
      onNavigate={(href) => router.push(href)}
    />
  );
}

function BreadcrumbView({
  items,
  className,
  onNavigate,
}: {
  items: BreadcrumbItem[];
  className?: string;
  onNavigate?: (href: string) => void;
}) {
  const all = [{ label: "Home", href: "/" }, ...items];

  const handleClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onNavigate) return;
    // Let the browser handle new-tab / modified clicks.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1.5 text-sm", className)}>
      {all.map((item, i) => {
        const isLast = i === all.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
            {isLast || !item.href ? (
              <span className="text-gray-900 dark:text-white font-medium">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                onClick={(e) => handleClick(e, item.href as string)}
                className="text-gray-500 dark:text-gray-400 hover:text-ophir-600 dark:hover:text-ophir-400 transition-colors"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
