import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export type CubicPoolEvent =
  | PoolInitializedEvent
  | SwapEvent
  | LiquidityAddedEvent
  | LiquidityRemovedEvent
  | ProtocolFeesCollectedEvent
  | PoolEnabledUpdatedEvent
  | SwapsEnabledUpdatedEvent
  | SingleTokenDepositEvent
  | UnknownEvent;

export interface PoolInitializedEvent {
  kind: "PoolInitialized";
  pool: PublicKey;
  config: PublicKey;
  tokenCount: number;
  bptMint: PublicKey;
  timestamp: number;
}

export interface SwapEvent {
  kind: "Swap";
  pool: PublicKey;
  user: PublicKey;
  tokenIn: PublicKey;
  tokenOut: PublicKey;
  amountIn: BN;
  amountOut: BN;
  feeAmount: BN;
  protocolFeeAmount: BN;
  timestamp: number;
}

export interface LiquidityAddedEvent {
  kind: "LiquidityAdded";
  pool: PublicKey;
  user: PublicKey;
  tokenAmounts: BN[];
  bptAmount: BN;
  timestamp: number;
}

export interface LiquidityRemovedEvent {
  kind: "LiquidityRemoved";
  pool: PublicKey;
  user: PublicKey;
  bptAmount: BN;
  tokenAmounts: BN[];
  timestamp: number;
}

export interface ProtocolFeesCollectedEvent {
  kind: "ProtocolFeesCollected";
  pool: PublicKey;
  authority: PublicKey;
  tokenAmounts: BN[];
  timestamp: number;
}

export interface PoolEnabledUpdatedEvent {
  kind: "PoolEnabledUpdated";
  pool: PublicKey;
  authority: PublicKey;
  oldValue: boolean;
  newValue: boolean;
  timestamp: number;
}

export interface SwapsEnabledUpdatedEvent {
  kind: "SwapsEnabledUpdated";
  pool: PublicKey;
  authority: PublicKey;
  oldValue: boolean;
  newValue: boolean;
  timestamp: number;
}

export interface SingleTokenDepositEvent {
  kind: "SingleTokenDeposit";
  helper: PublicKey;
  pool: PublicKey;
  user: PublicKey;
  tokenInIndex: number;
  amountIn: BN;
  slippageHundredthsBps: number;
  allocations: BN[];
  depositedAmounts: BN[];
  bptReceived: BN;
  dustRefunded: BN;
  timestamp: number;
}

export interface UnknownEvent {
  kind: "Unknown";
  name: string;
  data: Record<string, unknown>;
}
