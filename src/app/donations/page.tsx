"use client";
// SPDX-License-Identifier: MIT

import { usePageTitle } from "@/hooks/usePageTitle";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function DonationsPage() {
  usePageTitle("My Donations");

  const handleExport = () => {
    fetch("/api/donations/export")
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ophirpay-donations-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      });
  };

  const handleExportJson = () => {
    // Fetch JSON via content negotiation
    fetch("/api/donations/export", {
      headers: {
        Accept: "application/json",
      },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ophirpay-donations-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Donations" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            My Donations
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            View and export your donation history
          </p>
        </div>
      </div>

      <Card title="Donations Export" padding="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Export your complete donation history. This data is strictly scoped to your authenticated donor account.
          </p>
          <div className="flex gap-4">
            <Button onClick={handleExport}>
              Export my donations (CSV)
            </Button>
            <Button onClick={handleExportJson} variant="secondary">
              Export (JSON)
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
