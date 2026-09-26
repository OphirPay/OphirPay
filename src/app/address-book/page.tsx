"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  getAddressBook,
  saveAddress,
  removeAddress,
  searchAddressBook,
  type AddressEntry,
} from "@/lib/address-book";
import { isValidStellarAddress } from "@/lib/stellar";
import { exportToCsv } from "@/lib/csv";
import { shortenAddress, timeAgo } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/EmptyState";

interface ContactForm {
  label: string;
  publicKey: string;
  memo: string;
}

const EMPTY_FORM: ContactForm = { label: "", publicKey: "", memo: "" };

function validateForm(form: ContactForm): string | null {
  const label = form.label.trim();
  const address = form.publicKey.trim();
  if (!label) return "Please enter a nickname for this contact.";
  if (label.length > 100) return "Nickname must be 100 characters or fewer.";
  if (!isValidStellarAddress(address)) {
    return "Invalid Stellar address — must be 56 characters starting with G.";
  }
  if (form.memo.length > 28) {
    return "Memo must be 28 characters or fewer.";
  }
  return null;
}

export default function AddressBookPage() {
  const toast = useToast();
  const [contacts, setContacts] = useState<AddressEntry[]>(() => getAddressBook());
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ContactForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AddressEntry | null>(null);
  const [editingOriginalKey, setEditingOriginalKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);
  const [importPreview, setImportPreview] = useState<{ label: string; publicKey: string; memo?: string }[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return search.trim() ? searchAddressBook(search.trim()) : contacts;
  }, [contacts, search]);

  const refresh = () => setContacts(getAddressBook());

  const openAdd = () => {
    setEditingOriginalKey(null);
    setEditing(EMPTY_FORM);
    setFormError(null);
  };

  const openEdit = (entry: AddressEntry) => {
    setEditingOriginalKey(entry.publicKey);
    setEditing({
      label: entry.label,
      publicKey: entry.publicKey,
      memo: entry.memo ?? "",
    });
    setFormError(null);
  };

  // Stable identity so Modal's focus-management effect doesn't re-run (and
  // steal focus) on every keystroke inside the form.
  const closeEditor = useCallback(() => {
    setEditing(null);
    setFormError(null);
  }, []);

  const handleSave = () => {
    if (!editing) return;
    const error = validateForm(editing);
    if (error) {
      setFormError(error);
      return;
    }

    const label = editing.label.trim();
    const publicKey = editing.publicKey.trim();
    const memo = editing.memo.trim() || undefined;

    // The address is the identity — if it changed, drop the old entry first
    // so we don't end up with duplicates.
    if (editingOriginalKey && editingOriginalKey !== publicKey) {
      removeAddress(editingOriginalKey);
    }

    saveAddress({ publicKey, label, memo });
    refresh();
    closeEditor();
    toast.success(
      editingOriginalKey ? "Contact updated" : "Contact saved",
      shortenAddress(publicKey, 6)
    );
  };

  const handleDelete = () => {
    if (!deleting) return;
    removeAddress(deleting.publicKey);
    refresh();
    setDeleting(null);
    toast.success("Contact deleted", deleting.label);
  };

  const handleExport = () => {
    const book = getAddressBook();
    if (book.length === 0) {
      toast.info("Address book is empty", "Nothing to export");
      return;
    }
    exportToCsv(
      book,
      [
        { key: "label", header: "label" },
        { key: "publicKey", header: "address" },
        { key: "memo", header: "memo" },
      ],
      { filename: "address-book.csv" }
    );
    toast.success("Address book exported", \`\${book.length} contacts saved to address-book.csv\`);
  };

  const openImport = () => {
    setImporting(true);
    setImportErrors([]);
    setImportPreview([]);
    if (importInputRef.current) importInputRef.current.value = "";
  };

  const closeImport = () => {
    setImporting(false);
    setImportErrors([]);
    setImportPreview([]);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const rows = text.split(/\r?\n/).filter((r) => r.trim());
      if (rows.length < 2) {
        setImportErrors([{ row: 0, message: "CSV must have a header row and at least one data row." }]);
        return;
      }
      const header = rows[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
      const labelIdx = header.indexOf("label");
      const addressIdx = header.indexOf("address");
      const memoIdx = header.indexOf("memo");

      if (labelIdx < 0 || addressIdx < 0) {
        setImportErrors([{ row: 0, message: "CSV must contain 'label' and 'address' columns." }]);
        return;
      }

      const dataRows = rows.slice(1);
      const preview: { label: string; publicKey: string; memo?: string }[] = [];
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const cols = dataRows[i].split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
        const label = cols[labelIdx] ?? "";
        const address = cols[addressIdx] ?? "";
        const memo = memoIdx >= 0 ? cols[memoIdx] : "";

        if (!label) {
          errors.push({ row: i + 2, message: "Label is required." });
          continue;
        }
        if (!isValidStellarAddress(address)) {
          errors.push({ row: i + 2, message: `Invalid Stellar address: \${address}` });
          continue;
        }
        if (memo && memo.length > 28) {
          errors.push({ row: i + 2, message: "Memo must be 28 characters or fewer." });
          continue;
        }

        preview.push({ label, publicKey: address, memo: memo || undefined });
      }

      setImportPreview(preview);
      setImportErrors(errors);
    } catch (e) {
      setImportErrors([{ row: 0, message: "Failed to parse CSV file." }]);
    }
  };

  const handleConfirmImport = () => {
    if (importPreview.length === 0) return;
    const book = getAddressBook();
    const existing = new Set(book.map((a) => a.publicKey));
    let added = 0;
    let skipped = 0;

    for (const entry of importPreview) {
      if (existing.has(entry.publicKey)) {
        skipped++;
        continue;
      }
      saveAddress({ publicKey: entry.publicKey, label: entry.label, memo: entry.memo });
      added++;
    }
    refresh();
    closeImport();
    if (added > 0) toast.success(\`\${added} contact\${added !== 1 ? "s" : ""} imported\`, \`\${skipped} duplicate\${skipped !== 1 ? "s" : ""} skipped\`);
    else toast.info("No new contacts imported", \`\${skipped} already existed\`);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Address Book" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Address Book
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Frequently used Stellar addresses — stored locally in your browser
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={contacts.length === 0}>
            Export CSV
          </Button>
          <Button variant="outline" onClick={openImport}>
            Import CSV
          </Button>
          <Button onClick={openAdd} leftIcon={<PlusIcon />}>
            Add Contact
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by nickname or address..."
          aria-label="Search contacts"
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z"
              />
            </svg>
          }
          title={search ? "No contacts match your search" : "Your address book is empty"}
          description={
            search
              ? "Try a different nickname or address."
              : "Save a recipient to autofill it on the Send page."
          }
          actionLabel={search ? undefined : "Add your first contact"}
          onAction={search ? undefined : openAdd}
        />
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {filtered.map((entry) => (
            <li
              key={entry.publicKey}
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {entry.label}
                  </p>
                  {entry.lastUsed ? (
                    <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                      used {timeAgo(new Date(entry.lastUsed).toISOString())}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-mono text-gray-600 dark:text-gray-300 truncate">
                    {shortenAddress(entry.publicKey, 8)}
                  </span>
                  <CopyButton value={entry.publicKey} label="Address" />
                </div>
                {entry.memo ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    memo: {entry.memo}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(entry)}>
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleting(entry)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Import CSV modal */}
      <Modal
        open={importing}
        onClose={closeImport}
        title="Import Contacts from CSV"
        description="Upload a CSV with columns: label,address,memo (memo optional). Valid rows will be added; errors are shown below."
        footer={
          <>
            <Button variant="outline" onClick={closeImport}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={importPreview.length === 0}>
              Import {importPreview.length} Valid Contact{importPreview.length !== 1 ? "s" : ""}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-ophir-400 dark:hover:border-ophir-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-gray-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drag & drop your CSV here, or click to browse</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Columns: <span className="font-mono">label,address,memo</span> (memo optional)</p>
          </button>

          {importErrors.length > 0 && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                {importErrors.length} error{importErrors.length !== 1 ? "s" : ""} found:
              </p>
              <ul className="text-sm text-red-600 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto">
                {importErrors.map((e, i) => (
                  <li key={i}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {importPreview.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                    <th className="py-2 px-3 font-medium">Label</th>
                    <th className="py-2 px-3 font-medium min-w-[200px]">Address</th>
                    <th className="py-2 px-3 font-medium">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((entry, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800/50">
                      <td className="py-2 px-3">{entry.label}</td>
                      <td className="py-2 px-3 font-mono text-gray-600 dark:text-gray-400 truncate max-w-[200px]">{entry.publicKey}</td>
                      <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{entry.memo ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 px-3">
                {importPreview.length} valid row{importPreview.length !== 1 ? "s" : ""} ready to import
              </p>
            </div>
          )}

        </div>
      </Modal>

      {/* Add/Edit modal */}
      <Modal
        open={editing !== null}
        onClose={closeEditor}
        title={editingOriginalKey ? "Edit Contact" : "Add Contact"}
        description="Nickname + Stellar address, validated before saving."
        footer={
          <>
            <Button variant="outline" onClick={closeEditor}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingOriginalKey ? "Save Changes" : "Save Contact"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nickname"
            required
            value={editing?.label ?? ""}
            onChange={(e) =>
              setEditing((f) => (f ? { ...f, label: e.target.value } : f))
            }
            placeholder="e.g. Alice — Freelance"
            maxLength={100}
          />
          <Input
            label="Stellar Address"
            required
            value={editing?.publicKey ?? ""}
            onChange={(e) =>
              setEditing((f) => (f ? { ...f, publicKey: e.target.value } : f))
            }
            placeholder="G..."
            className="font-mono"
          />
          <Input
            label="Memo"
            hint="Optional destination tag (up to 28 characters) used when sending to this contact."
            value={editing?.memo ?? ""}
            onChange={(e) =>
              setEditing((f) => (f ? { ...f, memo: e.target.value } : f))
            }
            placeholder="e.g. Invoice #42"
            maxLength={28}
          />
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {formError}
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete contact?"
        description={`Remove "${deleting?.label ?? ""}" from your address book? This only affects your browser's local storage.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Contacts are stored locally via{" "}
        <code className="text-gray-500 dark:text-gray-400">localStorage</code> —
        they never leave your browser.{" "}
        <Link
          href="/send"
          className="text-ophir-600 dark:text-ophir-400 hover:underline"
        >
          Use them on the Send page →
        </Link>
      </p>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-4 h-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
