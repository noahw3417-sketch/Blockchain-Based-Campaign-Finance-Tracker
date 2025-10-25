import { describe, it, expect, beforeEach, vi } from "vitest";
import { uintCV, principalCV, boolCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_DONOR = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_CAMPAIGN_EXPIRED = 103;
const ERR_CAMPAIGN_NOT_FOUND = 104;
const ERR_LIMIT_EXCEEDED = 105;
const ERR_INSUFFICIENT_BALANCE = 106;
const ERR_INVALID_STATUS = 107;
const ERR_INVALID_DURATION = 108;
const ERR_INVALID_RECIPIENT = 109;
const ERR_ALREADY_INITIALIZED = 110;
const ERR_INVALID_MAX_DONATION = 111;
const ERR_INVALID_TOTAL_LIMIT = 112;

interface CampaignDetails {
  id: number;
  owner: string;
  maxPerDonation: number;
  totalLimit: number;
  currentTotal: number;
  startTime: number;
  duration: number;
  status: boolean;
}

interface Withdrawal {
  recipient: string;
  amount: number;
  timestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

interface LimitEnforcerMock {
  checkDonation: (donorId: number, campaignId: number, amount: number) => Result<boolean>;
}

interface TrackerMock {
  logDonation: (donorId: number, campaignId: number, amount: number) => Result<boolean>;
}

class CampaignMock {
  state: {
    campaignId: number;
    owner: string;
    maxPerDonation: number;
    totalLimit: number;
    currentTotal: number;
    startTime: number;
    duration: number;
    status: boolean;
    limitEnforcer: string | null;
    tracker: string | null;
    donorContributions: Map<number, number>;
    withdrawals: Map<number, Withdrawal>;
    balance: number;
  } = {
    campaignId: 0,
    owner: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    maxPerDonation: 0,
    totalLimit: 0,
    currentTotal: 0,
    startTime: 0,
    duration: 0,
    status: false,
    limitEnforcer: null,
    tracker: null,
    donorContributions: new Map(),
    withdrawals: new Map(),
    balance: 0,
  };
  blockHeight: number = 0;
  caller: string = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      campaignId: 0,
      owner: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      maxPerDonation: 0,
      totalLimit: 0,
      currentTotal: 0,
      startTime: 0,
      duration: 0,
      status: false,
      limitEnforcer: null,
      tracker: null,
      donorContributions: new Map(),
      withdrawals: new Map(),
      balance: 0,
    };
    this.blockHeight = 0;
    this.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    this.stxTransfers = [];
  }

  initialize(
    id: number,
    owner: string,
    maxDonation: number,
    totalCap: number,
    duration: number,
    enforcerContract: string,
    trackerContract: string
  ): Result<boolean> {
    if (this.state.status) return { ok: false, value: ERR_ALREADY_INITIALIZED };
    if (maxDonation <= 0) return { ok: false, value: ERR_INVALID_MAX_DONATION };
    if (totalCap <= 0) return { ok: false, value: ERR_INVALID_TOTAL_LIMIT };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_DURATION };
    if (owner === this.caller) return { ok: false, value: ERR_INVALID_RECIPIENT };
    this.state.campaignId = id;
    this.state.owner = owner;
    this.state.maxPerDonation = maxDonation;
    this.state.totalLimit = totalCap;
    this.state.duration = duration;
    this.state.startTime = this.blockHeight;
    this.state.limitEnforcer = enforcerContract;
    this.state.tracker = trackerContract;
    this.state.status = true;
    return { ok: true, value: true };
  }

  donate(donorId: number, amount: number, enforcer: LimitEnforcerMock, tracker: TrackerMock): Result<boolean> {
    if (!this.state.status) return { ok: false, value: ERR_INVALID_STATUS };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (this.blockHeight > this.state.startTime + this.state.duration) return { ok: false, value: ERR_CAMPAIGN_EXPIRED };
    if (amount > this.state.maxPerDonation) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (this.state.currentTotal + amount > this.state.totalLimit) return { ok: false, value: ERR_LIMIT_EXCEEDED };
    if (!this.state.limitEnforcer) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const enforcerResult = enforcer.checkDonation(donorId, this.state.campaignId, amount);
    if (!enforcerResult.ok) return enforcerResult;
    this.stxTransfers.push({ amount, from: this.caller, to: "contract" });
    const current = this.state.donorContributions.get(donorId) || 0;
    this.state.donorContributions.set(donorId, current + amount);
    this.state.currentTotal += amount;
    this.state.balance += amount;
    const trackerResult = tracker.logDonation(donorId, this.state.campaignId, amount);
    if (!trackerResult.ok) return trackerResult;
    return { ok: true, value: true };
  }

  withdraw(amount: number, recipient: string, enforcer: LimitEnforcerMock): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.status) return { ok: false, value: ERR_INVALID_STATUS };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (amount > this.state.balance) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (recipient === "contract") return { ok: false, value: ERR_INVALID_RECIPIENT };
    if (!this.state.limitEnforcer) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const enforcerResult = enforcer.checkDonation(0, this.state.campaignId, 0);
    if (!enforcerResult.ok) return enforcerResult;
    this.stxTransfers.push({ amount, from: "contract", to: recipient });
    this.state.balance -= amount;
    this.state.withdrawals.set(this.state.currentTotal, { recipient, amount, timestamp: this.blockHeight });
    return { ok: true, value: true };
  }

  setStatus(newStatus: boolean): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.status = newStatus;
    return { ok: true, value: true };
  }

  getBalance(): Result<number> {
    return { ok: true, value: this.state.balance };
  }

  getTotalDonations(): Result<number> {
    return { ok: true, value: this.state.currentTotal };
  }

  getCampaignDetails(): Result<CampaignDetails> {
    return {
      ok: true,
      value: {
        id: this.state.campaignId,
        owner: this.state.owner,
        maxPerDonation: this.state.maxPerDonation,
        totalLimit: this.state.totalLimit,
        currentTotal: this.state.currentTotal,
        startTime: this.state.startTime,
        duration: this.state.duration,
        status: this.state.status,
      },
    };
  }

  getDonorContribution(donorId: number): Result<number> {
    return { ok: true, value: this.state.donorContributions.get(donorId) || 0 };
  }

  getWithdrawal(withdrawalId: number): Result<Withdrawal | null> {
    return { ok: true, value: this.state.withdrawals.get(withdrawalId) || null };
  }

  isCampaignActive(): Result<boolean> {
    return { ok: true, value: this.state.status && this.blockHeight <= this.state.startTime + this.state.duration };
  }
}

describe("Campaign", () => {
  let contract: CampaignMock;
  let limitEnforcer: LimitEnforcerMock;
  let tracker: TrackerMock;

  beforeEach(() => {
    contract = new CampaignMock();
    limitEnforcer = { checkDonation: vi.fn().mockReturnValue({ ok: true, value: true }) };
    tracker = { logDonation: vi.fn().mockReturnValue({ ok: true, value: true }) };
    contract.reset();
  });

  it("initializes campaign successfully", () => {
    const result = contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const details = contract.getCampaignDetails().value;
    expect(details.id).toBe(1);
    expect(details.owner).toBe("ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
    expect(details.maxPerDonation).toBe(1000);
    expect(details.totalLimit).toBe(10000);
    expect(details.duration).toBe(100);
    expect(details.status).toBe(true);
  });

  it("rejects initialization if already initialized", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    const result = contract.initialize(
      2,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      2000,
      20000,
      200,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_INITIALIZED);
  });

  it("rejects invalid max donation", () => {
    const result = contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      0,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MAX_DONATION);
  });

  it("rejects invalid total limit", () => {
    const result = contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      0,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TOTAL_LIMIT);
  });

  it("rejects invalid duration", () => {
    const result = contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      0,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DURATION);
  });

  it("rejects invalid recipient", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.initialize(
      1,
      "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECIPIENT);
  });

  it("accepts donation successfully", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    const result = contract.donate(1, 500, limitEnforcer, tracker);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", to: "contract" }]);
    expect(contract.getDonorContribution(1).value).toBe(500);
    expect(contract.getTotalDonations().value).toBe(500);
    expect(limitEnforcer.checkDonation).toHaveBeenCalledWith(1, 1, 500);
    expect(tracker.logDonation).toHaveBeenCalledWith(1, 1, 500);
  });

  it("rejects donation if campaign is inactive", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.caller = "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.setStatus(false);
    const result = contract.donate(1, 500, limitEnforcer, tracker);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("rejects donation if campaign expired", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.blockHeight = 101;
    const result = contract.donate(1, 500, limitEnforcer, tracker);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CAMPAIGN_EXPIRED);
  });

  it("rejects donation exceeding max per donation", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    const result = contract.donate(1, 1500, limitEnforcer, tracker);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects donation exceeding total limit", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      1000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.donate(1, 800, limitEnforcer, tracker);
    const result = contract.donate(1, 300, limitEnforcer, tracker);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LIMIT_EXCEEDED);
  });

  it("rejects donation if enforcer fails", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    limitEnforcer.checkDonation = vi.fn().mockReturnValue({ ok: false, value: ERR_LIMIT_EXCEEDED });
    const result = contract.donate(1, 500, limitEnforcer, tracker);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LIMIT_EXCEEDED);
  });

  it("withdraws funds successfully", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.donate(1, 500, limitEnforcer, tracker);
    contract.caller = "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(300, "ST5PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", limitEnforcer);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.stxTransfers).toContainEqual({ amount: 300, from: "contract", to: "ST5PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM" });
    expect(contract.getBalance().value).toBe(200);
    expect(contract.getWithdrawal(500)?.value).toEqual({ recipient: "ST5PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", amount: 300, timestamp: 0 });
  });

  it("rejects withdrawal by non-owner", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.donate(1, 500, limitEnforcer, tracker);
    const result = contract.withdraw(300, "ST5PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", limitEnforcer);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects withdrawal if insufficient balance", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.donate(1, 500, limitEnforcer, tracker);
    contract.caller = "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(600, "ST5PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", limitEnforcer);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("rejects withdrawal if enforcer fails", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.donate(1, 500, limitEnforcer, tracker);
    contract.caller = "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    limitEnforcer.checkDonation = vi.fn().mockReturnValue({ ok: false, value: ERR_LIMIT_EXCEEDED });
    const result = contract.withdraw(300, "ST5PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", limitEnforcer);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LIMIT_EXCEEDED);
  });

  it("sets status successfully", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    contract.caller = "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.setStatus(false);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getCampaignDetails().value.status).toBe(false);
  });

  it("rejects set status by non-owner", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    const result = contract.setStatus(false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("checks campaign active status", () => {
    contract.initialize(
      1,
      "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      1000,
      10000,
      100,
      "ST3PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
      "ST4PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
    );
    expect(contract.isCampaignActive().value).toBe(true);
    contract.blockHeight = 101;
    expect(contract.isCampaignActive().value).toBe(false);
    contract.caller = "ST2PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.setStatus(false);
    expect(contract.isCampaignActive().value).toBe(false);
  });
});