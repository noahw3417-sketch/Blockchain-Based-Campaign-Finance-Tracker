import { describe, it, expect, beforeEach } from "vitest";
import { ClarityValue, uintCV, tupleCV, listCV, someCV, noneCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_DONOR = 102;
const ERR_INVALID_CAMPAIGN = 103;
const ERR_ENTRY_NOT_FOUND = 104;
const ERR_LIST_OVERFLOW = 105;
const ERR_INVALID_TIMESTAMP = 106;
const ERR_DUPLICATE_ENTRY = 107;
const ERR_QUERY_LIMIT_EXCEEDED = 108;

interface DonationEntry {
  "campaign-id": bigint;
  amount: bigint;
  timestamp: bigint;
  "donation-id": bigint;
}

interface CampaignEntry {
  "donor-id": bigint;
  amount: bigint;
  timestamp: bigint;
  "donation-id": bigint;
}

interface DonationDetails {
  "donor-id": bigint;
  "campaign-id": bigint;
  amount: bigint;
  timestamp: bigint;
}

interface PaginatedResult {
  items: DonationEntry[];
  total: number;
  "has-more": boolean;
}

class DonationTrackerMock {
  state: {
    nextDonationId: bigint;
    donorDonations: Map<bigint, DonationEntry[]>;
    campaignDonations: Map<bigint, CampaignEntry[]>;
    donationDetails: Map<bigint, DonationDetails>;
  } = {
    nextDonationId: 0n,
    donorDonations: new Map(),
    campaignDonations: new Map(),
    donationDetails: new Map(),
  };

  blockHeight: bigint = 100n;
  prints: Array<{[key: string]: any}> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextDonationId: 0n,
      donorDonations: new Map(),
      campaignDonations: new Map(),
      donationDetails: new Map(),
    };
    this.blockHeight = 100n;
    this.prints = [];
  }

  private getDonorEntries(donorId: bigint): DonationEntry[] {
    return this.state.donorDonations.get(donorId) || [];
  }

  private getCampaignEntries(campaignId: bigint): CampaignEntry[] {
    return this.state.campaignDonations.get(campaignId) || [];
  }

  logDonation(donorId: bigint, campaignId: bigint, amount: bigint): { ok: boolean; value: number | bigint } {
    if (donorId <= 0n) return { ok: false, value: ERR_INVALID_DONOR };
    if (campaignId <= 0n) return { ok: false, value: ERR_INVALID_CAMPAIGN };
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (this.blockHeight < 1n) return { ok: false, value: ERR_INVALID_TIMESTAMP };

    const donorEntries = this.getDonorEntries(donorId);
    if (donorEntries.length >= 200) return { ok: false, value: ERR_LIST_OVERFLOW };

    const campaignEntries = this.getCampaignEntries(campaignId);
    if (campaignEntries.length >= 200) return { ok: false, value: ERR_LIST_OVERFLOW };

    const donationId = this.state.nextDonationId;
    const entry = {
      "campaign-id": campaignId,
      amount,
      timestamp: this.blockHeight,
      "donation-id": donationId,
    };

    this.state.donorDonations.set(donorId, [...donorEntries, entry]);
    this.state.campaignDonations.set(campaignId, [...campaignEntries, {
      "donor-id": donorId,
      amount,
      timestamp: this.blockHeight,
      "donation-id": donationId,
    }]);

    this.state.donationDetails.set(donationId, {
      "donor-id": donorId,
      "campaign-id": campaignId,
      amount,
      timestamp: this.blockHeight,
    });

    this.state.nextDonationId += 1n;
    this.prints.push({
      event: "donation-logged",
      "donation-id": donationId,
      donor: donorId,
      campaign: campaignId,
      amount,
    });

    return { ok: true, value: donationId };
  }

  getDonation(donationId: bigint): DonationDetails | null {
    return this.state.donationDetails.get(donationId) || null;
  }

  getDonorDonations(donorId: bigint): DonationEntry[] {
    return this.getDonorEntries(donorId);
  }

  getCampaignDonations(campaignId: bigint): CampaignEntry[] {
    return this.getCampaignEntries(campaignId);
  }

  getDonorTotal(donorId: bigint): bigint {
    return this.getDonorDonations(donorId).reduce((sum, e) => sum + e.amount, 0n);
  }

  getCampaignTotal(campaignId: bigint): bigint {
    return this.getCampaignDonations(campaignId).reduce((sum, e) => sum + e.amount, 0n);
  }

  getDonorDonationsPaginated(donorId: bigint, start: number, limit: number): { ok: boolean; value: PaginatedResult | number } {
    if (limit > 100) return { ok: false, value: ERR_QUERY_LIMIT_EXCEEDED };
    const items = this.getDonorDonations(donorId);
    const total = items.length;
    const sliced = items.slice(start, start + limit);
    return {
      ok: true,
      value: {
        items: sliced,
        total,
        "has-more": total > start + limit,
      },
    };
  }

  getCampaignDonationsPaginated(campaignId: bigint, start: number, limit: number): { ok: boolean; value: PaginatedResult | number } {
    if (limit > 100) return { ok: false, value: ERR_QUERY_LIMIT_EXCEEDED };
    const items = this.getCampaignDonations(campaignId);
    const total = items.length;
    const sliced = items.slice(start, start + limit);
    return {
      ok: true,
      value: {
        items: sliced,
        total,
        "has-more": total > start + limit,
      },
    };
  }

  getLatestDonationId(): bigint {
    return this.state.nextDonationId > 0n ? this.state.nextDonationId - 1n : 0n;
  }

  getDonationCountByDonor(donorId: bigint): number {
    return this.getDonorDonations(donorId).length;
  }

  getDonationCountByCampaign(campaignId: bigint): number {
    return this.getCampaignDonations(campaignId).length;
  }

  getTotalDonations(): bigint {
    return this.state.nextDonationId;
  }
}

describe("DonationTracker", () => {
  let tracker: DonationTrackerMock;

  beforeEach(() => {
    tracker = new DonationTrackerMock();
    tracker.reset();
  });

  it("logs a donation successfully", () => {
    const result = tracker.logDonation(1n, 10n, 500n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);

    const details = tracker.getDonation(0n);
    expect(details).toEqual({
      "donor-id": 1n,
      "campaign-id": 10n,
      amount: 500n,
      timestamp: 100n,
    });

    expect(tracker.prints).toContainEqual({
      event: "donation-logged",
      "donation-id": 0n,
      donor: 1n,
      campaign: 10n,
      amount: 500n,
    });
  });

  it("logs multiple donations and tracks totals", () => {
    tracker.logDonation(1n, 10n, 500n);
    tracker.logDonation(1n, 20n, 300n);
    tracker.logDonation(2n, 10n, 700n);

    expect(tracker.getDonorTotal(1n)).toBe(800n);
    expect(tracker.getCampaignTotal(10n)).toBe(1200n);
    expect(tracker.getTotalDonations()).toBe(3n);
  });

  it("rejects invalid donor id", () => {
    const result = tracker.logDonation(0n, 10n, 500n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DONOR);
  });

  it("rejects invalid campaign id", () => {
    const result = tracker.logDonation(1n, 0n, 500n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CAMPAIGN);
  });

  it("rejects zero amount", () => {
    const result = tracker.logDonation(1n, 10n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("enforces per-donor entry limit", () => {
    for (let i = 0; i < 200; i++) {
      tracker.logDonation(1n, BigInt(i + 1), 100n);
    }
    const result = tracker.logDonation(1n, 201n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LIST_OVERFLOW);
  });

  it("enforces per-campaign entry limit", () => {
    for (let i = 0; i < 200; i++) {
      tracker.logDonation(BigInt(i + 1), 1n, 100n);
    }
    const result = tracker.logDonation(201n, 1n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LIST_OVERFLOW);
  });

  it("supports pagination for donor donations", () => {
    tracker.logDonation(1n, 10n, 100n);
    tracker.logDonation(1n, 20n, 200n);
    tracker.logDonation(1n, 30n, 300n);

    const result = tracker.getDonorDonationsPaginated(1n, 1, 1);
    expect(result.ok).toBe(true);
    expect((result.value as PaginatedResult).items).toHaveLength(1);
    expect((result.value as PaginatedResult).items[0].amount).toBe(200n);
    expect((result.value as PaginatedResult).total).toBe(3);
    expect((result.value as PaginatedResult)["has-more"]).toBe(true);
  });

  it("rejects pagination with excessive limit", () => {
    const result = tracker.getDonorDonationsPaginated(1n, 0, 101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_QUERY_LIMIT_EXCEEDED);
  });

  it("returns correct donation counts", () => {
    tracker.logDonation(1n, 10n, 100n);
    tracker.logDonation(1n, 20n, 200n);
    tracker.logDonation(2n, 10n, 300n);

    expect(tracker.getDonationCountByDonor(1n)).toBe(2);
    expect(tracker.getDonationCountByCampaign(10n)).toBe(2);
  });

  it("returns latest donation id correctly", () => {
    expect(tracker.getLatestDonationId()).toBe(0n);
    tracker.logDonation(1n, 10n, 100n);
    expect(tracker.getLatestDonationId()).toBe(0n);
    tracker.logDonation(2n, 20n, 200n);
    expect(tracker.getLatestDonationId()).toBe(1n);
  });

  it("handles empty donor query gracefully", () => {
    const entries = tracker.getDonorDonations(999n);
    expect(entries).toEqual([]);
    expect(tracker.getDonorTotal(999n)).toBe(0n);
  });
});