import { TonClient, Address, Cell } from "@ton/ton";

export interface SafetyConfig {
  minPoolDepthTon?: number;
  maxHolderConcentrationPct?: number;
  requireLpLock?: boolean;
  requireMintRevoked?: boolean;
  requireOwnershipRenounced?: boolean;
  minHolders?: number;
}

export interface JettonWalletData {
  balance: bigint;
  owner: Address;
}

export interface JettonMasterData {
  totalSupply: bigint;
  admin: Address | null;
  content: Cell | null;
  walletCode: Cell;
}

export interface SafetyCheckResult {
  passed: boolean;
  checks: SafetyCheck[];
  blockReason?: string;
}

export interface SafetyCheck {
  name: string;
  passed: boolean;
  detail: string;
  severity: "block" | "warn" | "info";
}

export interface PoolDepth {
  tonReserve: number;
  jettonReserve: number;
  priceTon: number;
}

export class PreTradeGate {
  private client: TonClient;
  private config: Required<SafetyConfig>;

  constructor(
    client: TonClient,
    config: SafetyConfig = {}
  ) {
    this.client = client;
    this.config = {
      minPoolDepthTon: config.minPoolDepthTon ?? 10,
      maxHolderConcentrationPct: config.maxHolderConcentrationPct ?? 20,
      requireLpLock: config.requireLpLock ?? true,
      requireMintRevoked: config.requireMintRevoked ?? true,
      requireOwnershipRenounced: config.requireOwnershipRenounced ?? true,
      minHolders: config.minHolders ?? 10,
    };
  }

  async checkJetton(jettonMasterAddress: string): Promise<SafetyCheckResult> {
    const checks: SafetyCheck[] = [];

    const masterData = await this.getJettonMasterData(jettonMasterAddress);
    if (!masterData) {
      return {
        passed: false,
        checks: [{ name: "jetton_exists", passed: false, detail: "Jetton master not found or invalid", severity: "block" }],
        blockReason: "Jetton master not found or invalid contract",
      };
    }

    if (this.config.requireOwnershipRenounced) {
      const ownershipCheck = await this.checkOwnershipRenounced(masterData);
      checks.push(ownershipCheck);
    }

    if (this.config.requireMintRevoked) {
      const mintCheck = await this.checkMintAuthorityRevoked(masterData);
      checks.push(mintCheck);
    }

    if (this.config.requireLpLock) {
      const lpCheck = await this.checkLpLocked(jettonMasterAddress);
      checks.push(lpCheck);
    }

    const poolDepth = await this.getPoolDepth(jettonMasterAddress);
    if (poolDepth) {
      checks.push({
        name: "pool_depth",
        passed: poolDepth.tonReserve >= this.config.minPoolDepthTon,
        detail: `Pool depth: ${poolDepth.tonReserve.toFixed(2)} TON (min: ${this.config.minPoolDepthTon})`,
        severity: poolDepth.tonReserve >= this.config.minPoolDepthTon ? "info" : "block",
      });
    } else {
      checks.push({
        name: "pool_exists",
        passed: false,
        detail: "No STON.fi/DeDust pool found for this jetton",
        severity: "block",
      });
    }

    const holderCheck = await this.checkHolderConcentration(jettonMasterAddress);
    checks.push(holderCheck);

    const holdersCheck = await this.checkMinHolders(jettonMasterAddress);
    checks.push(holdersCheck);

    const blockChecks = checks.filter(c => c.severity === "block" && !c.passed);
    const passed = blockChecks.length === 0;
    const blockReason = blockChecks.length > 0
      ? blockChecks.map(c => c.detail).join("; ")
      : undefined;

    return { passed, checks, blockReason };
  }

  private async getJettonMasterData(_address: string): Promise<JettonMasterData | null> {
    return null;
  }

  private async checkOwnershipRenounced(masterData: JettonMasterData): Promise<SafetyCheck> {
    const renounced = masterData.admin === null;
    return {
      name: "ownership_renounced",
      passed: renounced,
      detail: renounced
        ? "Ownership renounced (admin = null)"
        : `Ownership NOT renounced, admin: ${masterData.admin?.toString()}`,
      severity: "block",
    };
  }

  private async checkMintAuthorityRevoked(masterData: JettonMasterData): Promise<SafetyCheck> {
    const mintRevoked = masterData.admin === null;
    return {
      name: "mint_authority_revoked",
      passed: mintRevoked,
      detail: mintRevoked
        ? "Mint authority revoked (admin = null)"
        : "Mint authority ACTIVE - deployer can mint more supply",
      severity: "block",
    };
  }

  private async checkLpLocked(_jettonMasterAddress: string): Promise<SafetyCheck> {
    try {
      return {
        name: "lp_locked",
        passed: true,
        detail: "LP lock check requires pool-specific verification - manual review recommended",
        severity: "warn",
      };
    } catch {
      return {
        name: "lp_locked",
        passed: false,
        detail: "Could not verify LP lock status",
        severity: "warn",
      };
    }
  }

  private async getPoolDepth(_jettonMasterAddress: string): Promise<PoolDepth | null> {
    return null;
  }

  private async checkHolderConcentration(_jettonMasterAddress: string): Promise<SafetyCheck> {
    return { name: "holder_concentration", passed: true, detail: "holder concentration check skipped", severity: "info" };
  }

  private async checkMinHolders(_jettonMasterAddress: string): Promise<SafetyCheck> {
    return { name: "min_holders", passed: true, detail: "min holders check skipped", severity: "info" };
  }
}

export function createPreTradeGate(_config: SafetyConfig = {}): PreTradeGate {
  return new PreTradeGate(new TonClient({ endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC" }), _config);
}
