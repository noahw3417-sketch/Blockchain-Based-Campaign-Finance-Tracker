import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityValue, uintCV, someCV, noneCV, principalCV } from "@stacks/transactions";

interface DonationRecord {
  totalDonated: bigint;
}

interface CampaignRecord {
  totalReceived: bigint;
}

interface LimitEnforcerState {
  admin: string | null;
  globalAnnualLimit: bigint;
  cycleDurationBlocks: bigint;
  currentCycleIndex: bigint;
  donorCycles: Map<string, DonationRecord>;
  campaignCycles: Map<string, CampaignRecord>;
  donorRegistry: Map<string, number>;
  campaignRegistry: Map<string, number>;
  blockHeight: bigint;
}

class LimitEnforcerMock {
  state: LimitEnforcerState = {
    admin: null,
    globalAnnualLimit: BigInt(1_000_000_000),
    cycleDurationBlocks: BigInt(525_600),
    currentCycleIndex: BigInt(0),
    donorCycles: new Map(),
    campaignCycles: new Map(),
    donorRegistry: new Map(),
    campaignRegistry: new Map(),
    blockHeight: BigInt(0),
  };

  caller = "ST1TEST";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: null,
      globalAnnualLimit: BigInt(1_000_000_000),
      cycleDurationBlocks: BigInt(525_600),
      currentCycleIndex: BigInt(0),
      donorCycles: new Map(),
      campaignCycles: new Map(),
      donorRegistry: new Map(),
      campaignRegistry: new Map(),
      blockHeight: BigInt(0),
    };
    this.caller = "ST1TEST";
  }

  private getDonorKey(donorId: number, cycle: bigint): string {
    return `${donorId}-${cycle.toString()}`;
  }

  private getCampaignKey(campaignId: number, cycle: bigint): string {
    return `${campaignId}-${cycle.toString()}`;
  }

  private assertAdmin(): { ok: true } | { ok: false; value: number } {
    if (!this.state.admin) return { ok: false, value: 111 };
    if (this.state.admin !== this.caller) return { ok: false, value: 100 };
    return { ok: true };
  }

  private advanceCycleIfNeeded(): { ok: true } {
    const cycleStart = this.state.currentCycleIndex * this.state.cycleDurationBlocks;
    if (this.state.blockHeight >= cycleStart + this.state.cycleDurationBlocks) {
      this.state.currentCycleIndex += BigInt(1);
    }
    return { ok: true };
  }

  setAdmin(newAdmin: string): { ok: boolean; value?: number } {
    if (this.state.admin !== null) return { ok: false, value: 109 };
    this.state.admin = newAdmin;
    return { ok: true };
  }

  updateAdmin(newAdmin: string): { ok: boolean; value?: number } {
    const adminCheck = this.assertAdmin();
    if (!adminCheck.ok) return { ok: false, value: adminCheck.value };
    this.state.admin = newAdmin;
    return { ok: true };
  }

  setGlobalAnnualLimit(newLimit: bigint): { ok: boolean; value?: number } {
    const adminCheck = this.assertAdmin();
    if (!adminCheck.ok) return { ok: false, value: adminCheck.value };
    if (newLimit <= BigInt(0)) return { ok: false, value: 101 };
    this.state.globalAnnualLimit = newLimit;
    return { ok: true };
  }

  setCycleDuration(blocks: bigint): { ok: boolean; value?: number } {
    const adminCheck = this.assertAdmin();
    if (!adminCheck.ok) return { ok: false, value: adminCheck.value };
    if (blocks <= BigInt(0)) return { ok: false, value: 101 };
    this.state.cycleDurationBlocks = blocks;
    return { ok: true };
  }

  registerDonor(donor: string): { ok: boolean; value: number } {
    if (this.state.donorRegistry.has(donor)) return { ok: false, value: 102 };
    const id = this.state.donorRegistry.size + 1;
    this.state.donorRegistry.set(donor, id);
    return { ok: true, value: id };
  }

  registerCampaign(campaign: string): { ok: boolean; value: number } {
    if (this.state.campaignRegistry.has(campaign)) return { ok: false, value: 103 };
    const id = this.state.campaignRegistry.size + 1;
    this.state.campaignRegistry.set(campaign, id);
    return { ok: true, value: id };
  }

  checkDonation(donor: string, campaign: string, amount: bigint): { ok: boolean; value?: number } {
    const donorId = this.state.donorRegistry.get(donor);
    if (!donorId) return { ok: false, value: 102 };
    const campaignId = this.state.campaignRegistry.get(campaign);
    if (!campaignId) return { ok: false, value: 103 };

    this.advanceCycleIfNeeded();
    const cycleIndex = this.state.currentCycleIndex;
    const key = this.getDonorKey(donorId, cycleIndex);
    const record = this.state.donorCycles.get(key) || { totalDonated: BigInt(0) };

    if (record.totalDonated + amount > this.state.globalAnnualLimit) {
      return { ok: false, value: 104 };
    }

    this.state.donorCycles.set(key, { totalDonated: record.totalDonated + amount });

    const campKey = this.getCampaignKey(campaignId, cycleIndex);
    const campRecord = this.state.campaignCycles.get(campKey) || { totalReceived: BigInt(0) };
    this.state.campaignCycles.set(campKey, { totalReceived: campRecord.totalReceived + amount });

    return { ok: true };
  }

  forceAdvanceCycle(): { ok: boolean; value: bigint } {
    const adminCheck = this.assertAdmin();
    if (!adminCheck.ok) return { ok: false, value: BigInt(adminCheck.value) };
    this.state.currentCycleIndex += BigInt(1);
    return { ok: true, value: this.state.currentCycleIndex };
  }

  getDonorId(donor: string): number | null {
    return this.state.donorRegistry.get(donor) || null;
  }

  getCampaignId(campaign: string): number | null {
    return this.state.campaignRegistry.get(campaign) || null;
  }

  getTotalDonatedInCycle(donorId: number, cycleIndex: bigint): bigint {
    const key = this.getDonorKey(donorId, cycleIndex);
    return this.state.donorCycles.get(key)?.totalDonated || BigInt(0);
  }

  getTotalReceivedInCycle(campaignId: number, cycleIndex: bigint): bigint {
    const key = this.getCampaignKey(campaignId, cycleIndex);
    return this.state.campaignCycles.get(key)?.totalReceived || BigInt(0);
  }

  setBlockHeight(height: bigint) {
    this.state.blockHeight = height;
  }
}

describe("LimitEnforcer", () => {
  let mock: LimitEnforcerMock;

  beforeEach(() => {
    mock = new LimitEnforcerMock();
    mock.reset();
  });

  it("sets initial admin correctly", () => {
    const result = mock.setAdmin("ST1ADMIN");
    expect(result.ok).toBe(true);
    expect(mock.state.admin).toBe("ST1ADMIN");
  });

  it("rejects setting admin twice", () => {
    mock.setAdmin("ST1ADMIN");
    const result = mock.setAdmin("ST2ADMIN");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(109);
  });

  it("allows admin to update admin", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST1ADMIN";
    const result = mock.updateAdmin("ST2ADMIN");
    expect(result.ok).toBe(true);
    expect(mock.state.admin).toBe("ST2ADMIN");
  });

  it("rejects non-admin from updating admin", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST2HACKER";
    const result = mock.updateAdmin("ST2HACKER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(100);
  });

  it("sets global annual limit", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST1ADMIN";
    const result = mock.setGlobalAnnualLimit(BigInt(500_000_000));
    expect(result.ok).toBe(true);
    expect(mock.state.globalAnnualLimit).toBe(BigInt(500_000_000));
  });

  it("rejects invalid global limit", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST1ADMIN";
    const result = mock.setGlobalAnnualLimit(BigInt(0));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(101);
  });

  it("registers donor and campaign", () => {
    const donor = mock.registerDonor("ST1DONOR");
    const campaign = mock.registerCampaign("ST1CAMPAIGN");
    expect(donor.ok).toBe(true);
    expect(donor.value).toBe(1);
    expect(campaign.ok).toBe(true);
    expect(campaign.value).toBe(1);
  });

  it("rejects duplicate registration", () => {
    mock.registerDonor("ST1DONOR");
    const result = mock.registerDonor("ST1DONOR");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(102);
  });

  it("allows donation within limit", () => {
    mock.setAdmin("ST1ADMIN");
    mock.registerDonor("ST1DONOR");
    mock.registerCampaign("ST1CAMPAIGN");
    const result = mock.checkDonation("ST1DONOR", "ST1CAMPAIGN", BigInt(100_000_000));
    expect(result.ok).toBe(true);
  });

  it("rejects donation exceeding global limit", () => {
    mock.setAdmin("ST1ADMIN");
    mock.registerDonor("ST1DONOR");
    mock.registerCampaign("ST1CAMPAIGN");
    mock.checkDonation("ST1DONOR", "ST1CAMPAIGN", BigInt(600_000_000));
    const result = mock.checkDonation("ST1DONOR", "ST1CAMPAIGN", BigInt(600_000_000));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("advances cycle when block height exceeds duration", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST1ADMIN";
    mock.setCycleDuration(BigInt(100));
    mock.setBlockHeight(BigInt(150));
    mock.advanceCycleIfNeeded();
    expect(mock.state.currentCycleIndex).toBe(BigInt(1));
  });

  it("tracks donations per cycle correctly", () => {
    mock.setAdmin("ST1ADMIN");
    mock.registerDonor("ST1DONOR");
    mock.registerCampaign("ST1CAMPAIGN");
    mock.checkDonation("ST1DONOR", "ST1CAMPAIGN", BigInt(200_000_000));
    const total = mock.getTotalDonatedInCycle(1, BigInt(0));
    expect(total).toBe(BigInt(200_000_000));
  });

  it("admin can force advance cycle", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST1ADMIN";
    const result = mock.forceAdvanceCycle();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(BigInt(1));
  });

  it("non-admin cannot force advance cycle", () => {
    mock.setAdmin("ST1ADMIN");
    mock.caller = "ST2HACKER";
    const result = mock.forceAdvanceCycle();
    expect(result.ok).toBe(false);
  });

  it("correctly retrieves donor and campaign IDs", () => {
    mock.registerDonor("ST1DONOR");
    mock.registerCampaign("ST1CAMPAIGN");
    expect(mock.getDonorId("ST1DONOR")).toBe(1);
    expect(mock.getCampaignId("ST1CAMPAIGN")).toBe(1);
  });

  it("returns zero for non-existent cycle totals", () => {
    mock.registerDonor("ST1DONOR");
    const total = mock.getTotalDonatedInCycle(1, BigInt(999));
    expect(total).toBe(BigInt(0));
  });
});