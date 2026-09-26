// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import React from "react";
import { render } from "@testing-library/react";

import RootLoading from "@/app/loading";
import DashboardLoading from "@/app/(dashboard)/loading";
import AnalyticsLoading from "@/app/analytics/loading";
import AuditLogLoading from "@/app/audit-log/loading";
import BatchesLoading from "@/app/batches/loading";
import BatchDetailLoading from "@/app/batches/[id]/loading";
import ContractsLoading from "@/app/contracts/loading";
import EventsLoading from "@/app/events/loading";
import FeeConfigLoading from "@/app/fee-config/loading";
import GovernanceLoading from "@/app/governance/loading";
import HooksLoading from "@/app/hooks/loading";
import KeysLoading from "@/app/keys/loading";
import MultisigLoading from "@/app/multisig/loading";
import PauseControlsLoading from "@/app/pause-controls/loading";
import PaymentsLoading from "@/app/payments/loading";
import PaymentDetailLoading from "@/app/payments/[id]/loading";
import PolicyVersionsLoading from "@/app/policy-versions/loading";
import RbacLoading from "@/app/rbac/loading";
import RecurringLoading from "@/app/recurring/loading";
import RefundsLoading from "@/app/refunds/loading";
import RequestsLoading from "@/app/requests/loading";
import TimelockLoading from "@/app/timelock/loading";
import WebhooksLoading from "@/app/webhooks/loading";
import WebhookDetailLoading from "@/app/webhooks/[id]/loading";
import AddressBookLoading from "@/app/address-book/loading";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

const DATA_FETCHING_ROUTES = [
  "src/app/(dashboard)/loading.tsx",
  "src/app/analytics/loading.tsx",
  "src/app/audit-log/loading.tsx",
  "src/app/batches/loading.tsx",
  "src/app/batches/[id]/loading.tsx",
  "src/app/contracts/loading.tsx",
  "src/app/events/loading.tsx",
  "src/app/fee-config/loading.tsx",
  "src/app/governance/loading.tsx",
  "src/app/hooks/loading.tsx",
  "src/app/keys/loading.tsx",
  "src/app/multisig/loading.tsx",
  "src/app/pause-controls/loading.tsx",
  "src/app/payments/loading.tsx",
  "src/app/payments/[id]/loading.tsx",
  "src/app/policy-versions/loading.tsx",
  "src/app/rbac/loading.tsx",
  "src/app/recurring/loading.tsx",
  "src/app/refunds/loading.tsx",
  "src/app/requests/loading.tsx",
  "src/app/timelock/loading.tsx",
  "src/app/webhooks/loading.tsx",
  "src/app/webhooks/[id]/loading.tsx",
  "src/app/address-book/loading.tsx",
];

const LOADING_COMPONENTS: [string, React.ComponentType][] = [
  ["RootLoading", RootLoading],
  ["DashboardLoading", DashboardLoading],
  ["AnalyticsLoading", AnalyticsLoading],
  ["AuditLogLoading", AuditLogLoading],
  ["BatchesLoading", BatchesLoading],
  ["BatchDetailLoading", BatchDetailLoading],
  ["ContractsLoading", ContractsLoading],
  ["EventsLoading", EventsLoading],
  ["FeeConfigLoading", FeeConfigLoading],
  ["GovernanceLoading", GovernanceLoading],
  ["HooksLoading", HooksLoading],
  ["KeysLoading", KeysLoading],
  ["MultisigLoading", MultisigLoading],
  ["PauseControlsLoading", PauseControlsLoading],
  ["PaymentsLoading", PaymentsLoading],
  ["PaymentDetailLoading", PaymentDetailLoading],
  ["PolicyVersionsLoading", PolicyVersionsLoading],
  ["RbacLoading", RbacLoading],
  ["RecurringLoading", RecurringLoading],
  ["RefundsLoading", RefundsLoading],
  ["RequestsLoading", RequestsLoading],
  ["TimelockLoading", TimelockLoading],
  ["WebhooksLoading", WebhooksLoading],
  ["WebhookDetailLoading", WebhookDetailLoading],
  ["AddressBookLoading", AddressBookLoading],
];

describe("Route-level Loading Skeletons (#786)", () => {
  it("ensures every data-fetching route has an existing loading.tsx boundary", () => {
    for (const routePath of DATA_FETCHING_ROUTES) {
      const fullPath = path.resolve(process.cwd(), routePath);
      expect(
        fs.existsSync(fullPath),
        `Route loading boundary must exist at ${routePath}`
      ).toBe(true);
    }
  });

  it("renders page-shaped skeletons respecting reduced-motion preferences", () => {
    for (const [name, Component] of LOADING_COMPONENTS) {
      const { container, unmount } = render(<Component />);

      // Must have pulsing skeleton elements
      const pulses = container.querySelectorAll(".animate-pulse");
      expect(
        pulses.length,
        `${name} should contain structured skeleton placeholder elements`
      ).toBeGreaterThan(0);

      // Skeletons must respect reduced-motion
      const motionReduced = container.querySelectorAll(".motion-reduce\\:animate-none");
      expect(
        motionReduced.length,
        `${name} skeletons must respect prefers-reduced-motion: reduce`
      ).toBeGreaterThan(0);

      unmount();
    }
  });

  it("supports detail and timeline variants in LoadingSkeleton with reduced motion", () => {
    const { container: detailContainer } = render(
      <LoadingSkeleton variant="detail" lines={4} />
    );
    expect(detailContainer.querySelector(".motion-reduce\\:animate-none")).not.toBeNull();

    const { container: timelineContainer } = render(
      <LoadingSkeleton variant="timeline" />
    );
    expect(timelineContainer.querySelector(".motion-reduce\\:animate-none")).not.toBeNull();
  });

  it("Skeleton primitive respects motion reduction", () => {
    const { container } = render(<Skeleton width="100px" height="20px" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("motion-reduce:animate-none");
  });
});
