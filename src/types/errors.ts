// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run `npm run generate-errors` to update.

/**
 * Soroban contract error codes and enumeration.
 * Mirrors the PaymentError enum in contracts/ophirpay/src/errors.rs.
 */
export enum ContractErrorCode {
  /** Contract not initialized: call init() first */
  NotInitialized = 1,
  /** Contract already initialized */
  AlreadyInitialized = 2,
  /** Payment not found */
  PaymentNotFound = 3,
  /** Unauthorized: caller does not have permission */
  Unauthorized = 4,
  /** Invalid amount: must be greater than zero */
  InvalidAmount = 5,
  /** Escrow not yet due: deadline has not passed */
  EscrowNotDue = 6,
  /** Escrow already released */
  EscrowAlreadyReleased = 7,
  /** Escrow not found */
  EscrowNotFound = 8,
  /** Stream not started: start time is in the future */
  StreamNotStarted = 9,
  /** Stream already cancelled */
  StreamAlreadyCancelled = 10,
  /** Stream not found */
  StreamNotFound = 11,
  /** Stream fully claimed: no remaining balance */
  StreamFullyClaimed = 12,
  /** Batch too large: exceeds maximum recipients */
  BatchTooLarge = 13,
  /** Batch empty: no recipients provided */
  BatchEmpty = 14,
  /** Token transfer failed */
  TokenTransferFailed = 15,
  /** Insufficient balance to cover payment */
  InsufficientBalance = 16,
  /** Payment already cancelled */
  PaymentAlreadyCancelled = 17,
  /** Contract paused: operations are temporarily disabled */
  ContractPaused = 18,
  /** No tokens available to withdraw */
  NoTokensToWithdraw = 19,
  /** Upgrade not proposed: call propose_upgrade() first */
  UpgradeNotProposed = 20,
  /** Upgrade timelock active: 24-hour delay has not elapsed */
  UpgradeTimelockActive = 21,
  /** Multisig not configured: call set_multisig_config() first */
  MultisigNotConfigured = 22,
  /** Not a signer: you are not in the multisig signer list */
  NotASigner = 23,
  /** Already approved: duplicate approval detected */
  AlreadyApproved = 24,
  /** Threshold not met: insufficient approvals */
  ThresholdNotMet = 25,
  /** Already executed: this action has already been processed */
  AlreadyExecuted = 26,
  /** Not a role holder: insufficient RBAC permissions */
  NotARoleHolder = 27,
  /** Audit log empty: no entries recorded */
  AuditLogEmpty = 28,
  /** Audit entry not found */
  AuditEntryNotFound = 29,
  /** Recurring payment not found */
  RecurringNotFound = 30,
  /** Recurring payment not yet due */
  RecurringNotDue = 31,
  /** Recurring payment already cancelled */
  RecurringAlreadyCancelled = 32,
  /** Recurring payment expired: all payments completed */
  RecurringExpired = 33,
  /** Fee configuration not found */
  FeeConfigNotFound = 34,
  /** Fee too high: exceeds maximum 1000 bps (10%) */
  FeeTooHigh = 35,
  /** Timelocked action not found */
  TimelockNotFound = 36,
  /** Timelocked action not yet due: 24-hour delay has not elapsed */
  TimelockNotDue = 37,
  /** Timelocked action already executed */
  TimelockAlreadyExecuted = 38,
  /** Governance not configured: call configure_governance() first */
  GovernanceNotConfigured = 39,
  /** Proposal not found */
  ProposalNotFound = 40,
  /** Voting period ended: proposal is closed */
  VotingPeriodEnded = 41,
  /** Proposal already executed */
  ProposalAlreadyExecuted = 42,
  /** Quorum not met: insufficient votes cast */
  QuorumNotMet = 43,
  /** Proposal defeated: no votes exceeded yes votes */
  ProposalDefeated = 44,
  /** Deposit too low: must meet minimum proposal deposit */
  DepositTooLow = 45,
  /** Spending limit expired: limit has been deactivated or expired */
  SpendingLimitExpired = 46,
  /** Refund not found */
  RefundNotFound = 47,
  /** Refund already processed */
  RefundAlreadyProcessed = 48,
  /** Payment already refunded */
  PaymentAlreadyRefunded = 49,
  /** Refund window expired */
  RefundWindowExpired = 50,
  /** Already voted: each address may vote only once per proposal */
  AlreadyVoted = 51,
  /** Reentrant call detected: cross-contract reentry blocked */
  ReentrantCall = 52,
  /** Spending cap exceeded: total spend exceeds authorization */
  SpendCapExceeded = 53,
  /** Dispute already filed: a dispute exists for this transaction */
  DisputeAlreadyFiled = 54,
  /** Dispute not found */
  DisputeNotFound = 55,
  /** Dispute window expired: too late to file a dispute */
  DisputeWindowExpired = 56,
  /** Refund rejected: refund request was denied */
  RefundRejected = 57,
  /** Insufficient liquidity: pool cannot fulfill the order */
  InsufficientLiquidity = 58,
  /** Asset depegged: stablecoin is off its target peg */
  AssetDepegged = 59,
  /** Proposal not passed: insufficient yes votes */
  ProposalNotPassed = 60,
  /** Invalid signature: recovered signer does not match */
  InvalidSignature = 61,
  /** Hook not found */
  HookNotFound = 62,
  /** Hook already exists: duplicate hook registration */
  HookAlreadyExists = 63,
  /** Rate limit exceeded: too many requests */
  RateLimitExceeded = 64,
  /** Asset not supported by this contract */
  AssetNotSupported = 65,
  /** Invalid metadata length: exceeds maximum allowed */
  InvalidMetadataLength = 66,
  /** Maximum recipients exceeded */
  MaxRecipientsExceeded = 67,
  /** Duplicate recipient in batch */
  DuplicateRecipient = 68,
  /** Stream end time must be after start time */
  StreamEndBeforeStart = 69,
  /** Escrow deadline must be in the future */
  EscrowDeadlineInPast = 70,
  /** Pending ownership transfer: accept or cancel first */
  PendingOwnershipTransfer = 71,
  /** Ownership transfer expired: timelock elapsed without acceptance */
  OwnershipTransferExpired = 72,
  /** Invalid address format */
  InvalidAddressFormat = 73,
  /** Batch item failed: individual payment in batch error */
  BatchItemFailed = 74,
  /** Invalid recurring schedule type */
  RecurringScheduleInvalid = 75,
  /** Fee collector address not set */
  FeeCollectorNotSet = 76,
  /** Emitter contract not linked: call set_emitter() first */
  EmitterNotLinked = 77,
  /** Proposal deposit is locked: cannot withdraw while voting */
  ProposalDepositLocked = 78,
  /** Multisig signer limit exceeded */
  MultisigSignerLimit = 79,
  /** Invalid token contract address */
  InvalidTokenContract = 80,
  /** Storage limit exceeded: contract storage is full */
  StorageLimitExceeded = 81,
  /** Contract migration required: upgrade to continue */
  ContractMigrationRequired = 82,
  /** Invalid event type for notification hook */
  InvalidEventType = 83,
  /** Webhook URL too long: exceeds maximum length */
  WebhookUrlTooLong = 84,
  /** Maximum notification hooks exceeded */
  MaxHooksExceeded = 85,
  /** Notification hook is not active */
  HookNotActive = 86,
  /** Cross-contract call failed */
  CrossContractCallFailed = 87,
  /** Invalid ScVal encoding in parameters */
  InvalidScValEncoding = 88,
  /** Unsupported operation: not available in this version */
  UnsupportedOperation = 89,
  /** Contract not linked: configure linked contract first */
  ContractNotLinked = 90,
  /** Maximum signers exceeded for multisig */
  MaxSignersExceeded = 91,
  /** Zero address not allowed for this operation */
  ZeroAddressNotAllowed = 92,
  /** Invalid network: wrong Stellar network configured */
  InvalidNetwork = 93,
  /** Staking not configured: call configure_staking() first */
  StakingNotConfigured = 94,
  /** Staking already active: cannot modify while staking */
  StakingAlreadyActive = 95,
  /** Rewards pool empty: no rewards available for distribution */
  RewardsPoolEmpty = 96,
  /** Unstaking period active: funds are still in cooldown */
  UnstakingPeriodActive = 97,
  /** Minimum stake not met: stake must exceed the minimum */
  MinimumStakeNotMet = 98,
  /** Maximum stake exceeded: stake cannot exceed the cap */
  MaximumStakeExceeded = 99,
  /** Rewards already claimed for this epoch */
  RewardsAlreadyClaimed = 100,
  /** Delegation not allowed: delegator is not authorized */
  DelegationNotAllowed = 101,
  /** Validator not active: selected validator is offline */
  ValidatorNotActive = 102,
  /** Slashing condition met: stake is subject to penalty */
  SlashingConditionMet = 103,
  /** Staking is currently paused */
  StakingPaused = 104,
  /** Compound rewards failed: auto-compound error */
  CompoundRewardsFailed = 105,
  /** Yield too low: below minimum acceptable rate */
  YieldTooLow = 106,
  /** Staking period not ended: cannot unstake yet */
  StakingPeriodNotEnded = 107,
  /** Reward distribution failed: transfer error */
  RewardDistributionFailed = 108,
  /** Delegator not authorized for this validator */
  UnauthorizedDelegator = 109,
  /** Bridge not configured: call configure_bridge() first */
  BridgeNotConfigured = 110,
  /** Bridge is currently paused */
  BridgePaused = 111,
  /** Invalid source chain identifier */
  InvalidSourceChain = 112,
  /** Invalid destination chain identifier */
  InvalidDestinationChain = 113,
  /** Cross-chain proof invalid: verification failed */
  CrossChainProofInvalid = 114,
  /** Bridge relayer not set: configure relayer address */
  BridgeRelayerNotSet = 115,
  /** Bridge amount too low: below minimum transfer */
  BridgeAmountTooLow = 116,
  /** Bridge amount too high: exceeds maximum transfer */
  BridgeAmountTooHigh = 117,
  /** Bridge transaction expired: timeout reached */
  BridgeTransactionExpired = 118,
  /** Unsupported token pair for bridge transfer */
  UnsupportedTokenPair = 119,
  /** Insurance fund not configured */
  InsuranceFundNotConfigured = 120,
  /** Insurance fund empty: no funds available for claims */
  InsuranceFundEmpty = 121,
  /** Insurance claim already filed for this event */
  InsuranceClaimAlreadyFiled = 122,
  /** Insurance claim rejected: does not meet criteria */
  InsuranceClaimRejected = 123,
  /** Insurance claim window expired */
  InsuranceClaimWindowExpired = 124,
  /** Coverage limit exceeded: claim exceeds policy cap */
  CoverageLimitExceeded = 125,
  /** Premium not paid: insurance coverage is inactive */
  PremiumNotPaid = 126,
  /** Risk score too high: coverage denied */
  RiskScoreTooHigh = 127,
  /** Underwriting failed: risk assessment error */
  UnderwritingFailed = 128,
  /** Insurance operations are currently paused */
  InsurancePaused = 129,
  /** KYC not completed: identity verification required */
  KYCNotCompleted = 130,
  /** KYC tier too low: upgrade verification level */
  KYCTierTooLow = 131,
  /** AML flag raised: transaction blocked for review */
  AMLFlagRaised = 132,
  /** Sanctions list match: address is restricted */
  SanctionsListMatch = 133,
  /** Identity verification failed: documents invalid */
  IdentityVerificationFailed = 134,
  /** Travel rule violation: beneficiary info required */
  TravelRuleViolation = 135,
  /** Jurisdiction not supported for this operation */
  JurisdictionNotSupported = 136,
  /** Residency check failed: proof of residency required */
  ResidencyCheckFailed = 137,
  /** Accreditation required: investor status not verified */
  AccreditationRequired = 138,
  /** Age verification failed: minimum age not met */
  AgeVerificationFailed = 139,
  /** Payment route not found: no valid path */
  PaymentRouteNotFound = 140,
  /** Payment split failed: distribution error */
  PaymentSplitFailed = 141,
  /** Split percentage invalid: must sum to 100% */
  SplitPercentageInvalid = 142,
  /** Route hop limit exceeded: path too long */
  RouteHopLimitExceeded = 143,
  /** Path payment too expensive: exceeds max fee */
  PathPaymentTooExpensive = 144,
  /** Liquidity pool not found for asset pair */
  LiquidityPoolNotFound = 145,
  /** Slippage exceeded: price moved beyond tolerance */
  SlippageExceeded = 146,
  /** Deadline exceeded: transaction too old */
  DeadlineExceeded = 147,
  /** Price oracle stale: last update too old */
  PriceOracleStale = 148,
  /** Flash loan not repaid in same transaction */
  FlashLoanNotRepaid = 149,
  /** Out of gas: computation budget exhausted */
  OutOfGas = 150,
  /** Gas price too low: below network minimum */
  GasPriceTooLow = 151,
  /** Gas refund failed: refund transfer error */
  GasRefundFailed = 152,
  /** Memory limit exceeded: allocation too large */
  MemoryLimitExceeded = 153,
  /** Stack depth exceeded: too many nested calls */
  StackDepthExceeded = 154,
  /** Instruction budget exceeded: too many operations */
  InstructionBudgetExceeded = 155,
  /** Read budget exceeded: too many storage reads */
  ReadBudgetExceeded = 156,
  /** Write budget exceeded: too many storage writes */
  WriteBudgetExceeded = 157,
  /** TTL too low: entry would expire too soon */
  TTLTooLow = 158,
  /** Ledger entry limit reached: cannot create more */
  LedgerEntryLimitReached = 159,
  /** Oracle not configured: call set_oracle() first */
  OracleNotConfigured = 160,
  /** Oracle timeout: response took too long */
  OracleTimeout = 161,
  /** Oracle price deviation: outlier detected */
  OraclePriceDeviation = 162,
  /** Data feed unavailable: source is offline */
  DataFeedUnavailable = 163,
  /** Data feed tampered: integrity check failed */
  DataFeedTampered = 164,
  /** Oracle already active: duplicate registration */
  OracleAlreadyActive = 165,
  /** Price feed stale: last update exceeds threshold */
  PriceFeedStale = 166,
  /** Confidence interval too wide: price uncertain */
  ConfidenceIntervalTooWide = 167,
  /** Oracle signature invalid: attestation failed */
  OracleSignatureInvalid = 168,
  /** Maximum price age exceeded: feed too old */
  MaxPriceAgeExceeded = 169,
  /** Batch execution timeout: not all items finished */
  BatchExecutionTimeout = 170,
  /** Batch partial failure: some items failed */
  BatchPartialFailure = 171,
  /** Stream rate invalid: must be positive non-zero */
  StreamRateInvalid = 172,
  /** Stream duration too long: exceeds maximum */
  StreamTooLong = 173,
  /** Stream claim too early: minimum interval not met */
  StreamClaimTooEarly = 174,
  /** Batch authorization failed: signer rejected */
  BatchAuthorizationFailed = 175,
  /** Batch duplicate ID: transaction already processed */
  BatchDuplicateId = 176,
  /** Stream beneficiary unchanged: same as current */
  StreamBeneficiaryUnchanged = 177,
  /** Stream transfer not allowed: stream is non-transferable */
  StreamTransferNotAllowed = 178,
  /** Batch cleanup failed: stale state removal error */
  BatchCleanupFailed = 179,
  /** Dispute not open: no active dispute found */
  DisputeNotOpen = 180,
  /** Dispute arbiter not set: configure arbiter first */
  DisputeArbiterNotSet = 181,
  /** Dispute evidence required: must submit proof */
  DisputeEvidenceRequired = 182,
  /** Dispute already resolved: final decision made */
  DisputeAlreadyResolved = 183,
  /** Dispute resolution timed out: arbiter did not respond */
  DisputeResolutionTimedOut = 184,
  /** Arbiter not authorized: not in approved list */
  ArbiterNotAuthorized = 185,
  /** Mediation failed: parties could not agree */
  MediationFailed = 186,
  /** Appeal window closed: too late to appeal */
  AppealWindowClosed = 187,
  /** Dispute bond insufficient: must stake more */
  DisputeBondInsufficient = 188,
  /** Dispute escalation failed: higher authority error */
  DisputeEscalationFailed = 189,
  /** Maximum storage entries reached: ledger full */
  MaxStorageEntriesReached = 190,
  /** Storage fee not paid: rent payment required */
  StorageFeeNotPaid = 191,
  /** Archive entry not found: record already pruned */
  ArchiveEntryNotFound = 192,
  /** State sync mismatch: ledger state inconsistent */
  StateSyncMismatch = 193,
  /** Migration in progress: try again later */
  MigrationInProgress = 194,
  /** Rollback detected: chain reorganization */
  RollbackDetected = 195,
  /** Snapshot verification failed: hash mismatch */
  SnapshotVerificationFailed = 196,
  /** Contract deprecated: use the new version */
  ContractDeprecated = 197,
  /** Emergency shutdown active: all operations blocked */
  EmergencyShutdownActive = 198,
  /** System overloaded: too many concurrent requests */
  SystemOverloaded = 199,
  /** Delegate not active: delegator is offline or disabled */
  DelegateNotActive = 200,
  /** Delegation expired: delegation period has ended */
  DelegationExpired = 201,
  /** Vote delegation mismatch: delegate does not match voter */
  VoteDelegationMismatch = 202,
  /** Proposal cancelled: proposal was withdrawn by creator */
  ProposalCancelled = 203,
  /** Proposal quorum changed: quorum was modified mid-vote */
  ProposalQuorumChanged = 204,
  /** Emergency governance paused: voting is temporarily suspended */
  EmergencyGovernancePaused = 205,
  /** Governance token locked: tokens are in a lockup period */
  GovernanceTokenLocked = 206,
  /** Voting power frozen: votes are immobilized by a freeze */
  VotingPowerFrozen = 207,
  /** Proposal execution failed: on-chain execution reverted */
  ProposalExecutionFailed = 208,
  /** Governance upgrade pending: upgrade has not been finalized */
  GovernanceUpgradePending = 209,
  /** Treasury not configured: call configure_treasury() first */
  TreasuryNotConfigured = 210,
  /** Treasury withdrawal pending: timelock has not elapsed */
  TreasuryWithdrawalPending = 211,
  /** Reserve requirement not met: minimum reserve ratio breached */
  ReserveRequirementNotMet = 212,
  /** Treasury multisig required: threshold signatures missing */
  TreasuryMultisigRequired = 213,
  /** Reserve asset unavailable: asset cannot be used as reserve */
  ReserveAssetUnavailable = 214,
  /** Treasury report mismatch: balance does not match ledger */
  TreasuryReportMismatch = 215,
  /** Reserve ratio breached: reserves fell below the minimum */
  ReserveRatioBreached = 216,
  /** Treasury audit failed: reconciliation check did not pass */
  TreasuryAuditFailed = 217,
  /** Reserve rebalance failed: allocation update reverted */
  ReserveRebalanceFailed = 218,
  /** Treasury access revoked: caller permissions were removed */
  TreasuryAccessRevoked = 219,
  /** Token already listed: asset is already supported */
  TokenAlreadyListed = 220,
  /** Token delisting pending: removal is awaiting timelock */
  TokenDelistingPending = 221,
  /** Asset pair not found: no market exists for the pair */
  AssetPairNotFound = 222,
  /** Token supply cap exceeded: mint would exceed the cap */
  TokenSupplyCapExceeded = 223,
  /** Minting paused: new issuance is temporarily disabled */
  MintingPaused = 224,
  /** Burning paused: token destruction is temporarily disabled */
  BurningPaused = 225,
  /** Token frozen: asset transfers are blocked */
  TokenFrozen = 226,
  /** Asset trustline missing: trustline must be established */
  AssetTrustlineMissing = 227,
  /** Token metadata invalid: name, symbol, or decimals malformed */
  TokenMetadataInvalid = 228,
  /** Asset migration pending: upgrade to new contract incomplete */
  AssetMigrationPending = 229,
  /** Lending pool not configured: call configure_lending() first */
  LendingPoolNotConfigured = 230,
  /** Loan not found */
  LoanNotFound = 231,
  /** Loan already repaid: no outstanding balance */
  LoanAlreadyRepaid = 232,
  /** Collateral insufficient: below required ratio */
  CollateralInsufficient = 233,
  /** Liquidation pending: position is in the process of liquidation */
  LiquidationPending = 234,
  /** Interest rate invalid: outside allowed bounds */
  InterestRateInvalid = 235,
  /** Credit limit exceeded: borrow would exceed the limit */
  CreditLimitExceeded = 236,
  /** Loan maturity reached: repayment is now due */
  LoanMaturityReached = 237,
  /** Collateral frozen: collateral cannot be moved */
  CollateralFrozen = 238,
  /** Lending paused: borrow and lend operations are suspended */
  LendingPaused = 239,
  /** Subscription not found */
  SubscriptionNotFound = 240,
  /** Subscription already cancelled */
  SubscriptionAlreadyCancelled = 241,
  /** Subscription renewal failed: payment did not settle */
  SubscriptionRenewalFailed = 242,
  /** Billing cycle invalid: interval is not supported */
  BillingCycleInvalid = 243,
  /** Subscription paused: renewals are temporarily halted */
  SubscriptionPaused = 244,
  /** Trial period expired: paid plan is now required */
  TrialPeriodExpired = 245,
  /** Payment method invalid: token or method not accepted */
  PaymentMethodInvalid = 246,
  /** Subscription tier not allowed: upgrade is restricted */
  SubscriptionTierNotAllowed = 247,
  /** Usage quota exceeded: plan allowance has been reached */
  UsageQuotaExceeded = 248,
  /** Subscription upgrade pending: change has not been applied */
  SubscriptionUpgradePending = 249,
  /** Zero-knowledge proof invalid: verification failed */
  ZkProofInvalid = 250,
  /** Privacy pool not configured: call configure_privacy() first */
  PrivacyPoolNotConfigured = 251,
  /** Commitment already spent: double-spend detected */
  CommitmentAlreadySpent = 252,
  /** Nullifier already used: proof was previously consumed */
  NullifierAlreadyUsed = 253,
  /** Merkle path invalid: membership proof is malformed */
  MerklePathInvalid = 254,
  /** Privacy deposit too low: below the minimum amount */
  PrivacyDepositTooLow = 255,
  /** Privacy withdrawal pending: timelock has not elapsed */
  PrivacyWithdrawalPending = 256,
  /** Stealth address invalid: cannot derive recipient */
  StealthAddressInvalid = 257,
  /** Confidential transfer failed: shielded amount mismatch */
  ConfidentialTransferFailed = 258,
  /** Privacy paused: shielded operations are suspended */
  PrivacyPaused = 259,
  /** Notification service down: delivery backend unavailable */
  NotificationServiceDown = 260,
  /** Message too long: exceeds maximum length */
  MessageTooLong = 261,
  /** Recipient unsubscribed: target has opted out */
  RecipientUnsubscribed = 262,
  /** Notification delivery failed: could not reach recipient */
  NotificationDeliveryFailed = 263,
  /** Notification rate limited: too many messages sent */
  NotificationRateLimited = 264,
  /** Message signature invalid: sender could not be verified */
  MessageSignatureInvalid = 265,
  /** Inbox full: recipient storage limit reached */
  InboxFull = 266,
  /** Notification template invalid: malformed payload */
  NotificationTemplateInvalid = 267,
  /** Message expired: delivery window has passed */
  MessageExpired = 268,
  /** Notification channel closed: channel is no longer active */
  NotificationChannelClosed = 269,
  /** Report generation failed: aggregation error */
  ReportGenerationFailed = 270,
  /** Analytics data missing: required metrics unavailable */
  AnalyticsDataMissing = 271,
  /** Metric out of range: value exceeds allowed bounds */
  MetricOutOfRange = 272,
  /** Report too large: exceeds maximum output size */
  ReportTooLarge = 273,
  /** Snapshot not found: requested point-in-time state missing */
  SnapshotNotFound = 274,
  /** Aggregation window invalid: time range is malformed */
  AggregationWindowInvalid = 275,
  /** Data retention expired: historical data was pruned */
  DataRetentionExpired = 276,
  /** Report access denied: insufficient permissions */
  ReportAccessDenied = 277,
  /** Analytics quota exceeded: too many report requests */
  AnalyticsQuotaExceeded = 278,
  /** Export format unsupported: requested format is not available */
  ExportFormatUnsupported = 279,
  /** SEP protocol violation: interface contract was not honored */
  SepProtocolViolation = 280,
  /** Asset not SEP-compliant: missing required SEP behavior */
  AssetNotSepCompliant = 281,
  /** Cross-contract version mismatch: incompatible API versions */
  CrossContractVersionMismatch = 282,
  /** Interface not implemented: required method is missing */
  InterfaceNotImplemented = 283,
  /** Standards compliance failed: validation did not pass */
  StandardsComplianceFailed = 284,
  /** Protocol upgrade required: dependency is out of date */
  ProtocolUpgradeRequired = 285,
  /** Interop handshake failed: connection could not be established */
  InteropHandshakeFailed = 286,
  /** Namespace collision: identifier is already registered */
  NamespaceCollision = 287,
  /** External system unavailable: dependency is offline */
  ExternalSystemUnavailable = 288,
  /** Interop rate limit exceeded: too many cross-system calls */
  InteropRateLimitExceeded = 289,
  /** Contract upgrade scheduled: upgrade is pending execution */
  ContractUpgradeScheduled = 290,
  /** Maintenance mode active: operations temporarily disabled */
  MaintenanceModeActive = 291,
  /** Circuit breaker tripped: safety threshold was exceeded */
  CircuitBreakerTripped = 292,
  /** Emergency freeze active: all state changes are blocked */
  EmergencyFreezeActive = 293,
  /** System clock drift detected: ledger time is inconsistent */
  SystemClockDriftDetected = 294,
  /** Ledger version unsupported: network upgrade required */
  LedgerVersionUnsupported = 295,
  /** Network partition detected: consensus is unavailable */
  NetworkPartitionDetected = 296,
  /** Resource exhaustion warning: limits are near capacity */
  ResourceExhaustionWarning = 297,
  /** Grace period active: transitional restrictions in effect */
  GracePeriodActive = 298,
  /** Configuration invalid: stored configuration is malformed */
  ConfigurationInvalid = 299,
  /** System fatal error: unrecoverable internal failure */
  SystemFatalError = 300,
  /** Revocation not found */
  RevocationNotFound = 301,
  /** Revocation not due */
  RevocationNotDue = 302,
  /** Revocation already executed */
  RevocationAlreadyExecuted = 303,
  /** Cannot revoke self */
  CannotRevokeSelf = 304,
  /** No pending ownership transfer */
  NoPendingOwner = 305,
  /** Math overflow */
  MathOverflow = 306,
  /** Stream accounting invariant violated: refused to pay an inconsistent amount */
  StreamInvariantViolated = 307,
  /** Pause scope not recognized: unknown scope identifier */
  InvalidPauseScope = 308,
  /** Idempotency key was reused for a different payment payload */
  PaymentIdempotencyConflict = 309,
}

export type ContractErrorCodeName = keyof typeof ContractErrorCode;

export interface ContractErrorInfo {
  name: string;
  code: number;
  message: string;
}

/**
 * Mapping of numeric error code to variant name.
 */
export const CONTRACT_ERROR_NAMES: Record<number, string> = {
  1: "NotInitialized",
  2: "AlreadyInitialized",
  3: "PaymentNotFound",
  4: "Unauthorized",
  5: "InvalidAmount",
  6: "EscrowNotDue",
  7: "EscrowAlreadyReleased",
  8: "EscrowNotFound",
  9: "StreamNotStarted",
  10: "StreamAlreadyCancelled",
  11: "StreamNotFound",
  12: "StreamFullyClaimed",
  13: "BatchTooLarge",
  14: "BatchEmpty",
  15: "TokenTransferFailed",
  16: "InsufficientBalance",
  17: "PaymentAlreadyCancelled",
  18: "ContractPaused",
  19: "NoTokensToWithdraw",
  20: "UpgradeNotProposed",
  21: "UpgradeTimelockActive",
  22: "MultisigNotConfigured",
  23: "NotASigner",
  24: "AlreadyApproved",
  25: "ThresholdNotMet",
  26: "AlreadyExecuted",
  27: "NotARoleHolder",
  28: "AuditLogEmpty",
  29: "AuditEntryNotFound",
  30: "RecurringNotFound",
  31: "RecurringNotDue",
  32: "RecurringAlreadyCancelled",
  33: "RecurringExpired",
  34: "FeeConfigNotFound",
  35: "FeeTooHigh",
  36: "TimelockNotFound",
  37: "TimelockNotDue",
  38: "TimelockAlreadyExecuted",
  39: "GovernanceNotConfigured",
  40: "ProposalNotFound",
  41: "VotingPeriodEnded",
  42: "ProposalAlreadyExecuted",
  43: "QuorumNotMet",
  44: "ProposalDefeated",
  45: "DepositTooLow",
  46: "SpendingLimitExpired",
  47: "RefundNotFound",
  48: "RefundAlreadyProcessed",
  49: "PaymentAlreadyRefunded",
  50: "RefundWindowExpired",
  51: "AlreadyVoted",
  52: "ReentrantCall",
  53: "SpendCapExceeded",
  54: "DisputeAlreadyFiled",
  55: "DisputeNotFound",
  56: "DisputeWindowExpired",
  57: "RefundRejected",
  58: "InsufficientLiquidity",
  59: "AssetDepegged",
  60: "ProposalNotPassed",
  61: "InvalidSignature",
  62: "HookNotFound",
  63: "HookAlreadyExists",
  64: "RateLimitExceeded",
  65: "AssetNotSupported",
  66: "InvalidMetadataLength",
  67: "MaxRecipientsExceeded",
  68: "DuplicateRecipient",
  69: "StreamEndBeforeStart",
  70: "EscrowDeadlineInPast",
  71: "PendingOwnershipTransfer",
  72: "OwnershipTransferExpired",
  73: "InvalidAddressFormat",
  74: "BatchItemFailed",
  75: "RecurringScheduleInvalid",
  76: "FeeCollectorNotSet",
  77: "EmitterNotLinked",
  78: "ProposalDepositLocked",
  79: "MultisigSignerLimit",
  80: "InvalidTokenContract",
  81: "StorageLimitExceeded",
  82: "ContractMigrationRequired",
  83: "InvalidEventType",
  84: "WebhookUrlTooLong",
  85: "MaxHooksExceeded",
  86: "HookNotActive",
  87: "CrossContractCallFailed",
  88: "InvalidScValEncoding",
  89: "UnsupportedOperation",
  90: "ContractNotLinked",
  91: "MaxSignersExceeded",
  92: "ZeroAddressNotAllowed",
  93: "InvalidNetwork",
  94: "StakingNotConfigured",
  95: "StakingAlreadyActive",
  96: "RewardsPoolEmpty",
  97: "UnstakingPeriodActive",
  98: "MinimumStakeNotMet",
  99: "MaximumStakeExceeded",
  100: "RewardsAlreadyClaimed",
  101: "DelegationNotAllowed",
  102: "ValidatorNotActive",
  103: "SlashingConditionMet",
  104: "StakingPaused",
  105: "CompoundRewardsFailed",
  106: "YieldTooLow",
  107: "StakingPeriodNotEnded",
  108: "RewardDistributionFailed",
  109: "UnauthorizedDelegator",
  110: "BridgeNotConfigured",
  111: "BridgePaused",
  112: "InvalidSourceChain",
  113: "InvalidDestinationChain",
  114: "CrossChainProofInvalid",
  115: "BridgeRelayerNotSet",
  116: "BridgeAmountTooLow",
  117: "BridgeAmountTooHigh",
  118: "BridgeTransactionExpired",
  119: "UnsupportedTokenPair",
  120: "InsuranceFundNotConfigured",
  121: "InsuranceFundEmpty",
  122: "InsuranceClaimAlreadyFiled",
  123: "InsuranceClaimRejected",
  124: "InsuranceClaimWindowExpired",
  125: "CoverageLimitExceeded",
  126: "PremiumNotPaid",
  127: "RiskScoreTooHigh",
  128: "UnderwritingFailed",
  129: "InsurancePaused",
  130: "KYCNotCompleted",
  131: "KYCTierTooLow",
  132: "AMLFlagRaised",
  133: "SanctionsListMatch",
  134: "IdentityVerificationFailed",
  135: "TravelRuleViolation",
  136: "JurisdictionNotSupported",
  137: "ResidencyCheckFailed",
  138: "AccreditationRequired",
  139: "AgeVerificationFailed",
  140: "PaymentRouteNotFound",
  141: "PaymentSplitFailed",
  142: "SplitPercentageInvalid",
  143: "RouteHopLimitExceeded",
  144: "PathPaymentTooExpensive",
  145: "LiquidityPoolNotFound",
  146: "SlippageExceeded",
  147: "DeadlineExceeded",
  148: "PriceOracleStale",
  149: "FlashLoanNotRepaid",
  150: "OutOfGas",
  151: "GasPriceTooLow",
  152: "GasRefundFailed",
  153: "MemoryLimitExceeded",
  154: "StackDepthExceeded",
  155: "InstructionBudgetExceeded",
  156: "ReadBudgetExceeded",
  157: "WriteBudgetExceeded",
  158: "TTLTooLow",
  159: "LedgerEntryLimitReached",
  160: "OracleNotConfigured",
  161: "OracleTimeout",
  162: "OraclePriceDeviation",
  163: "DataFeedUnavailable",
  164: "DataFeedTampered",
  165: "OracleAlreadyActive",
  166: "PriceFeedStale",
  167: "ConfidenceIntervalTooWide",
  168: "OracleSignatureInvalid",
  169: "MaxPriceAgeExceeded",
  170: "BatchExecutionTimeout",
  171: "BatchPartialFailure",
  172: "StreamRateInvalid",
  173: "StreamTooLong",
  174: "StreamClaimTooEarly",
  175: "BatchAuthorizationFailed",
  176: "BatchDuplicateId",
  177: "StreamBeneficiaryUnchanged",
  178: "StreamTransferNotAllowed",
  179: "BatchCleanupFailed",
  180: "DisputeNotOpen",
  181: "DisputeArbiterNotSet",
  182: "DisputeEvidenceRequired",
  183: "DisputeAlreadyResolved",
  184: "DisputeResolutionTimedOut",
  185: "ArbiterNotAuthorized",
  186: "MediationFailed",
  187: "AppealWindowClosed",
  188: "DisputeBondInsufficient",
  189: "DisputeEscalationFailed",
  190: "MaxStorageEntriesReached",
  191: "StorageFeeNotPaid",
  192: "ArchiveEntryNotFound",
  193: "StateSyncMismatch",
  194: "MigrationInProgress",
  195: "RollbackDetected",
  196: "SnapshotVerificationFailed",
  197: "ContractDeprecated",
  198: "EmergencyShutdownActive",
  199: "SystemOverloaded",
  200: "DelegateNotActive",
  201: "DelegationExpired",
  202: "VoteDelegationMismatch",
  203: "ProposalCancelled",
  204: "ProposalQuorumChanged",
  205: "EmergencyGovernancePaused",
  206: "GovernanceTokenLocked",
  207: "VotingPowerFrozen",
  208: "ProposalExecutionFailed",
  209: "GovernanceUpgradePending",
  210: "TreasuryNotConfigured",
  211: "TreasuryWithdrawalPending",
  212: "ReserveRequirementNotMet",
  213: "TreasuryMultisigRequired",
  214: "ReserveAssetUnavailable",
  215: "TreasuryReportMismatch",
  216: "ReserveRatioBreached",
  217: "TreasuryAuditFailed",
  218: "ReserveRebalanceFailed",
  219: "TreasuryAccessRevoked",
  220: "TokenAlreadyListed",
  221: "TokenDelistingPending",
  222: "AssetPairNotFound",
  223: "TokenSupplyCapExceeded",
  224: "MintingPaused",
  225: "BurningPaused",
  226: "TokenFrozen",
  227: "AssetTrustlineMissing",
  228: "TokenMetadataInvalid",
  229: "AssetMigrationPending",
  230: "LendingPoolNotConfigured",
  231: "LoanNotFound",
  232: "LoanAlreadyRepaid",
  233: "CollateralInsufficient",
  234: "LiquidationPending",
  235: "InterestRateInvalid",
  236: "CreditLimitExceeded",
  237: "LoanMaturityReached",
  238: "CollateralFrozen",
  239: "LendingPaused",
  240: "SubscriptionNotFound",
  241: "SubscriptionAlreadyCancelled",
  242: "SubscriptionRenewalFailed",
  243: "BillingCycleInvalid",
  244: "SubscriptionPaused",
  245: "TrialPeriodExpired",
  246: "PaymentMethodInvalid",
  247: "SubscriptionTierNotAllowed",
  248: "UsageQuotaExceeded",
  249: "SubscriptionUpgradePending",
  250: "ZkProofInvalid",
  251: "PrivacyPoolNotConfigured",
  252: "CommitmentAlreadySpent",
  253: "NullifierAlreadyUsed",
  254: "MerklePathInvalid",
  255: "PrivacyDepositTooLow",
  256: "PrivacyWithdrawalPending",
  257: "StealthAddressInvalid",
  258: "ConfidentialTransferFailed",
  259: "PrivacyPaused",
  260: "NotificationServiceDown",
  261: "MessageTooLong",
  262: "RecipientUnsubscribed",
  263: "NotificationDeliveryFailed",
  264: "NotificationRateLimited",
  265: "MessageSignatureInvalid",
  266: "InboxFull",
  267: "NotificationTemplateInvalid",
  268: "MessageExpired",
  269: "NotificationChannelClosed",
  270: "ReportGenerationFailed",
  271: "AnalyticsDataMissing",
  272: "MetricOutOfRange",
  273: "ReportTooLarge",
  274: "SnapshotNotFound",
  275: "AggregationWindowInvalid",
  276: "DataRetentionExpired",
  277: "ReportAccessDenied",
  278: "AnalyticsQuotaExceeded",
  279: "ExportFormatUnsupported",
  280: "SepProtocolViolation",
  281: "AssetNotSepCompliant",
  282: "CrossContractVersionMismatch",
  283: "InterfaceNotImplemented",
  284: "StandardsComplianceFailed",
  285: "ProtocolUpgradeRequired",
  286: "InteropHandshakeFailed",
  287: "NamespaceCollision",
  288: "ExternalSystemUnavailable",
  289: "InteropRateLimitExceeded",
  290: "ContractUpgradeScheduled",
  291: "MaintenanceModeActive",
  292: "CircuitBreakerTripped",
  293: "EmergencyFreezeActive",
  294: "SystemClockDriftDetected",
  295: "LedgerVersionUnsupported",
  296: "NetworkPartitionDetected",
  297: "ResourceExhaustionWarning",
  298: "GracePeriodActive",
  299: "ConfigurationInvalid",
  300: "SystemFatalError",
  301: "RevocationNotFound",
  302: "RevocationNotDue",
  303: "RevocationAlreadyExecuted",
  304: "CannotRevokeSelf",
  305: "NoPendingOwner",
  306: "MathOverflow",
  307: "StreamInvariantViolated",
  308: "InvalidPauseScope",
  309: "PaymentIdempotencyConflict",
};

/**
 * Mapping of numeric error code to human-readable message.
 */
export const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: "Contract not initialized: call init() first",
  2: "Contract already initialized",
  3: "Payment not found",
  4: "Unauthorized: caller does not have permission",
  5: "Invalid amount: must be greater than zero",
  6: "Escrow not yet due: deadline has not passed",
  7: "Escrow already released",
  8: "Escrow not found",
  9: "Stream not started: start time is in the future",
  10: "Stream already cancelled",
  11: "Stream not found",
  12: "Stream fully claimed: no remaining balance",
  13: "Batch too large: exceeds maximum recipients",
  14: "Batch empty: no recipients provided",
  15: "Token transfer failed",
  16: "Insufficient balance to cover payment",
  17: "Payment already cancelled",
  18: "Contract paused: operations are temporarily disabled",
  19: "No tokens available to withdraw",
  20: "Upgrade not proposed: call propose_upgrade() first",
  21: "Upgrade timelock active: 24-hour delay has not elapsed",
  22: "Multisig not configured: call set_multisig_config() first",
  23: "Not a signer: you are not in the multisig signer list",
  24: "Already approved: duplicate approval detected",
  25: "Threshold not met: insufficient approvals",
  26: "Already executed: this action has already been processed",
  27: "Not a role holder: insufficient RBAC permissions",
  28: "Audit log empty: no entries recorded",
  29: "Audit entry not found",
  30: "Recurring payment not found",
  31: "Recurring payment not yet due",
  32: "Recurring payment already cancelled",
  33: "Recurring payment expired: all payments completed",
  34: "Fee configuration not found",
  35: "Fee too high: exceeds maximum 1000 bps (10%)",
  36: "Timelocked action not found",
  37: "Timelocked action not yet due: 24-hour delay has not elapsed",
  38: "Timelocked action already executed",
  39: "Governance not configured: call configure_governance() first",
  40: "Proposal not found",
  41: "Voting period ended: proposal is closed",
  42: "Proposal already executed",
  43: "Quorum not met: insufficient votes cast",
  44: "Proposal defeated: no votes exceeded yes votes",
  45: "Deposit too low: must meet minimum proposal deposit",
  46: "Spending limit expired: limit has been deactivated or expired",
  47: "Refund not found",
  48: "Refund already processed",
  49: "Payment already refunded",
  50: "Refund window expired",
  51: "Already voted: each address may vote only once per proposal",
  52: "Reentrant call detected: cross-contract reentry blocked",
  53: "Spending cap exceeded: total spend exceeds authorization",
  54: "Dispute already filed: a dispute exists for this transaction",
  55: "Dispute not found",
  56: "Dispute window expired: too late to file a dispute",
  57: "Refund rejected: refund request was denied",
  58: "Insufficient liquidity: pool cannot fulfill the order",
  59: "Asset depegged: stablecoin is off its target peg",
  60: "Proposal not passed: insufficient yes votes",
  61: "Invalid signature: recovered signer does not match",
  62: "Hook not found",
  63: "Hook already exists: duplicate hook registration",
  64: "Rate limit exceeded: too many requests",
  65: "Asset not supported by this contract",
  66: "Invalid metadata length: exceeds maximum allowed",
  67: "Maximum recipients exceeded",
  68: "Duplicate recipient in batch",
  69: "Stream end time must be after start time",
  70: "Escrow deadline must be in the future",
  71: "Pending ownership transfer: accept or cancel first",
  72: "Ownership transfer expired: timelock elapsed without acceptance",
  73: "Invalid address format",
  74: "Batch item failed: individual payment in batch error",
  75: "Invalid recurring schedule type",
  76: "Fee collector address not set",
  77: "Emitter contract not linked: call set_emitter() first",
  78: "Proposal deposit is locked: cannot withdraw while voting",
  79: "Multisig signer limit exceeded",
  80: "Invalid token contract address",
  81: "Storage limit exceeded: contract storage is full",
  82: "Contract migration required: upgrade to continue",
  83: "Invalid event type for notification hook",
  84: "Webhook URL too long: exceeds maximum length",
  85: "Maximum notification hooks exceeded",
  86: "Notification hook is not active",
  87: "Cross-contract call failed",
  88: "Invalid ScVal encoding in parameters",
  89: "Unsupported operation: not available in this version",
  90: "Contract not linked: configure linked contract first",
  91: "Maximum signers exceeded for multisig",
  92: "Zero address not allowed for this operation",
  93: "Invalid network: wrong Stellar network configured",
  94: "Staking not configured: call configure_staking() first",
  95: "Staking already active: cannot modify while staking",
  96: "Rewards pool empty: no rewards available for distribution",
  97: "Unstaking period active: funds are still in cooldown",
  98: "Minimum stake not met: stake must exceed the minimum",
  99: "Maximum stake exceeded: stake cannot exceed the cap",
  100: "Rewards already claimed for this epoch",
  101: "Delegation not allowed: delegator is not authorized",
  102: "Validator not active: selected validator is offline",
  103: "Slashing condition met: stake is subject to penalty",
  104: "Staking is currently paused",
  105: "Compound rewards failed: auto-compound error",
  106: "Yield too low: below minimum acceptable rate",
  107: "Staking period not ended: cannot unstake yet",
  108: "Reward distribution failed: transfer error",
  109: "Delegator not authorized for this validator",
  110: "Bridge not configured: call configure_bridge() first",
  111: "Bridge is currently paused",
  112: "Invalid source chain identifier",
  113: "Invalid destination chain identifier",
  114: "Cross-chain proof invalid: verification failed",
  115: "Bridge relayer not set: configure relayer address",
  116: "Bridge amount too low: below minimum transfer",
  117: "Bridge amount too high: exceeds maximum transfer",
  118: "Bridge transaction expired: timeout reached",
  119: "Unsupported token pair for bridge transfer",
  120: "Insurance fund not configured",
  121: "Insurance fund empty: no funds available for claims",
  122: "Insurance claim already filed for this event",
  123: "Insurance claim rejected: does not meet criteria",
  124: "Insurance claim window expired",
  125: "Coverage limit exceeded: claim exceeds policy cap",
  126: "Premium not paid: insurance coverage is inactive",
  127: "Risk score too high: coverage denied",
  128: "Underwriting failed: risk assessment error",
  129: "Insurance operations are currently paused",
  130: "KYC not completed: identity verification required",
  131: "KYC tier too low: upgrade verification level",
  132: "AML flag raised: transaction blocked for review",
  133: "Sanctions list match: address is restricted",
  134: "Identity verification failed: documents invalid",
  135: "Travel rule violation: beneficiary info required",
  136: "Jurisdiction not supported for this operation",
  137: "Residency check failed: proof of residency required",
  138: "Accreditation required: investor status not verified",
  139: "Age verification failed: minimum age not met",
  140: "Payment route not found: no valid path",
  141: "Payment split failed: distribution error",
  142: "Split percentage invalid: must sum to 100%",
  143: "Route hop limit exceeded: path too long",
  144: "Path payment too expensive: exceeds max fee",
  145: "Liquidity pool not found for asset pair",
  146: "Slippage exceeded: price moved beyond tolerance",
  147: "Deadline exceeded: transaction too old",
  148: "Price oracle stale: last update too old",
  149: "Flash loan not repaid in same transaction",
  150: "Out of gas: computation budget exhausted",
  151: "Gas price too low: below network minimum",
  152: "Gas refund failed: refund transfer error",
  153: "Memory limit exceeded: allocation too large",
  154: "Stack depth exceeded: too many nested calls",
  155: "Instruction budget exceeded: too many operations",
  156: "Read budget exceeded: too many storage reads",
  157: "Write budget exceeded: too many storage writes",
  158: "TTL too low: entry would expire too soon",
  159: "Ledger entry limit reached: cannot create more",
  160: "Oracle not configured: call set_oracle() first",
  161: "Oracle timeout: response took too long",
  162: "Oracle price deviation: outlier detected",
  163: "Data feed unavailable: source is offline",
  164: "Data feed tampered: integrity check failed",
  165: "Oracle already active: duplicate registration",
  166: "Price feed stale: last update exceeds threshold",
  167: "Confidence interval too wide: price uncertain",
  168: "Oracle signature invalid: attestation failed",
  169: "Maximum price age exceeded: feed too old",
  170: "Batch execution timeout: not all items finished",
  171: "Batch partial failure: some items failed",
  172: "Stream rate invalid: must be positive non-zero",
  173: "Stream duration too long: exceeds maximum",
  174: "Stream claim too early: minimum interval not met",
  175: "Batch authorization failed: signer rejected",
  176: "Batch duplicate ID: transaction already processed",
  177: "Stream beneficiary unchanged: same as current",
  178: "Stream transfer not allowed: stream is non-transferable",
  179: "Batch cleanup failed: stale state removal error",
  180: "Dispute not open: no active dispute found",
  181: "Dispute arbiter not set: configure arbiter first",
  182: "Dispute evidence required: must submit proof",
  183: "Dispute already resolved: final decision made",
  184: "Dispute resolution timed out: arbiter did not respond",
  185: "Arbiter not authorized: not in approved list",
  186: "Mediation failed: parties could not agree",
  187: "Appeal window closed: too late to appeal",
  188: "Dispute bond insufficient: must stake more",
  189: "Dispute escalation failed: higher authority error",
  190: "Maximum storage entries reached: ledger full",
  191: "Storage fee not paid: rent payment required",
  192: "Archive entry not found: record already pruned",
  193: "State sync mismatch: ledger state inconsistent",
  194: "Migration in progress: try again later",
  195: "Rollback detected: chain reorganization",
  196: "Snapshot verification failed: hash mismatch",
  197: "Contract deprecated: use the new version",
  198: "Emergency shutdown active: all operations blocked",
  199: "System overloaded: too many concurrent requests",
  200: "Delegate not active: delegator is offline or disabled",
  201: "Delegation expired: delegation period has ended",
  202: "Vote delegation mismatch: delegate does not match voter",
  203: "Proposal cancelled: proposal was withdrawn by creator",
  204: "Proposal quorum changed: quorum was modified mid-vote",
  205: "Emergency governance paused: voting is temporarily suspended",
  206: "Governance token locked: tokens are in a lockup period",
  207: "Voting power frozen: votes are immobilized by a freeze",
  208: "Proposal execution failed: on-chain execution reverted",
  209: "Governance upgrade pending: upgrade has not been finalized",
  210: "Treasury not configured: call configure_treasury() first",
  211: "Treasury withdrawal pending: timelock has not elapsed",
  212: "Reserve requirement not met: minimum reserve ratio breached",
  213: "Treasury multisig required: threshold signatures missing",
  214: "Reserve asset unavailable: asset cannot be used as reserve",
  215: "Treasury report mismatch: balance does not match ledger",
  216: "Reserve ratio breached: reserves fell below the minimum",
  217: "Treasury audit failed: reconciliation check did not pass",
  218: "Reserve rebalance failed: allocation update reverted",
  219: "Treasury access revoked: caller permissions were removed",
  220: "Token already listed: asset is already supported",
  221: "Token delisting pending: removal is awaiting timelock",
  222: "Asset pair not found: no market exists for the pair",
  223: "Token supply cap exceeded: mint would exceed the cap",
  224: "Minting paused: new issuance is temporarily disabled",
  225: "Burning paused: token destruction is temporarily disabled",
  226: "Token frozen: asset transfers are blocked",
  227: "Asset trustline missing: trustline must be established",
  228: "Token metadata invalid: name, symbol, or decimals malformed",
  229: "Asset migration pending: upgrade to new contract incomplete",
  230: "Lending pool not configured: call configure_lending() first",
  231: "Loan not found",
  232: "Loan already repaid: no outstanding balance",
  233: "Collateral insufficient: below required ratio",
  234: "Liquidation pending: position is in the process of liquidation",
  235: "Interest rate invalid: outside allowed bounds",
  236: "Credit limit exceeded: borrow would exceed the limit",
  237: "Loan maturity reached: repayment is now due",
  238: "Collateral frozen: collateral cannot be moved",
  239: "Lending paused: borrow and lend operations are suspended",
  240: "Subscription not found",
  241: "Subscription already cancelled",
  242: "Subscription renewal failed: payment did not settle",
  243: "Billing cycle invalid: interval is not supported",
  244: "Subscription paused: renewals are temporarily halted",
  245: "Trial period expired: paid plan is now required",
  246: "Payment method invalid: token or method not accepted",
  247: "Subscription tier not allowed: upgrade is restricted",
  248: "Usage quota exceeded: plan allowance has been reached",
  249: "Subscription upgrade pending: change has not been applied",
  250: "Zero-knowledge proof invalid: verification failed",
  251: "Privacy pool not configured: call configure_privacy() first",
  252: "Commitment already spent: double-spend detected",
  253: "Nullifier already used: proof was previously consumed",
  254: "Merkle path invalid: membership proof is malformed",
  255: "Privacy deposit too low: below the minimum amount",
  256: "Privacy withdrawal pending: timelock has not elapsed",
  257: "Stealth address invalid: cannot derive recipient",
  258: "Confidential transfer failed: shielded amount mismatch",
  259: "Privacy paused: shielded operations are suspended",
  260: "Notification service down: delivery backend unavailable",
  261: "Message too long: exceeds maximum length",
  262: "Recipient unsubscribed: target has opted out",
  263: "Notification delivery failed: could not reach recipient",
  264: "Notification rate limited: too many messages sent",
  265: "Message signature invalid: sender could not be verified",
  266: "Inbox full: recipient storage limit reached",
  267: "Notification template invalid: malformed payload",
  268: "Message expired: delivery window has passed",
  269: "Notification channel closed: channel is no longer active",
  270: "Report generation failed: aggregation error",
  271: "Analytics data missing: required metrics unavailable",
  272: "Metric out of range: value exceeds allowed bounds",
  273: "Report too large: exceeds maximum output size",
  274: "Snapshot not found: requested point-in-time state missing",
  275: "Aggregation window invalid: time range is malformed",
  276: "Data retention expired: historical data was pruned",
  277: "Report access denied: insufficient permissions",
  278: "Analytics quota exceeded: too many report requests",
  279: "Export format unsupported: requested format is not available",
  280: "SEP protocol violation: interface contract was not honored",
  281: "Asset not SEP-compliant: missing required SEP behavior",
  282: "Cross-contract version mismatch: incompatible API versions",
  283: "Interface not implemented: required method is missing",
  284: "Standards compliance failed: validation did not pass",
  285: "Protocol upgrade required: dependency is out of date",
  286: "Interop handshake failed: connection could not be established",
  287: "Namespace collision: identifier is already registered",
  288: "External system unavailable: dependency is offline",
  289: "Interop rate limit exceeded: too many cross-system calls",
  290: "Contract upgrade scheduled: upgrade is pending execution",
  291: "Maintenance mode active: operations temporarily disabled",
  292: "Circuit breaker tripped: safety threshold was exceeded",
  293: "Emergency freeze active: all state changes are blocked",
  294: "System clock drift detected: ledger time is inconsistent",
  295: "Ledger version unsupported: network upgrade required",
  296: "Network partition detected: consensus is unavailable",
  297: "Resource exhaustion warning: limits are near capacity",
  298: "Grace period active: transitional restrictions in effect",
  299: "Configuration invalid: stored configuration is malformed",
  300: "System fatal error: unrecoverable internal failure",
  301: "Revocation not found",
  302: "Revocation not due",
  303: "Revocation already executed",
  304: "Cannot revoke self",
  305: "No pending ownership transfer",
  306: "Math overflow",
  307: "Stream accounting invariant violated: refused to pay an inconsistent amount",
  308: "Pause scope not recognized: unknown scope identifier",
  309: "Idempotency key was reused for a different payment payload",
};

/**
 * Complete list of all contract error entries in numeric order.
 */
export const ALL_CONTRACT_ERRORS: ContractErrorInfo[] = [
  { name: "NotInitialized", code: 1, message: "Contract not initialized: call init() first" },
  { name: "AlreadyInitialized", code: 2, message: "Contract already initialized" },
  { name: "PaymentNotFound", code: 3, message: "Payment not found" },
  { name: "Unauthorized", code: 4, message: "Unauthorized: caller does not have permission" },
  { name: "InvalidAmount", code: 5, message: "Invalid amount: must be greater than zero" },
  { name: "EscrowNotDue", code: 6, message: "Escrow not yet due: deadline has not passed" },
  { name: "EscrowAlreadyReleased", code: 7, message: "Escrow already released" },
  { name: "EscrowNotFound", code: 8, message: "Escrow not found" },
  { name: "StreamNotStarted", code: 9, message: "Stream not started: start time is in the future" },
  { name: "StreamAlreadyCancelled", code: 10, message: "Stream already cancelled" },
  { name: "StreamNotFound", code: 11, message: "Stream not found" },
  { name: "StreamFullyClaimed", code: 12, message: "Stream fully claimed: no remaining balance" },
  { name: "BatchTooLarge", code: 13, message: "Batch too large: exceeds maximum recipients" },
  { name: "BatchEmpty", code: 14, message: "Batch empty: no recipients provided" },
  { name: "TokenTransferFailed", code: 15, message: "Token transfer failed" },
  { name: "InsufficientBalance", code: 16, message: "Insufficient balance to cover payment" },
  { name: "PaymentAlreadyCancelled", code: 17, message: "Payment already cancelled" },
  { name: "ContractPaused", code: 18, message: "Contract paused: operations are temporarily disabled" },
  { name: "NoTokensToWithdraw", code: 19, message: "No tokens available to withdraw" },
  { name: "UpgradeNotProposed", code: 20, message: "Upgrade not proposed: call propose_upgrade() first" },
  { name: "UpgradeTimelockActive", code: 21, message: "Upgrade timelock active: 24-hour delay has not elapsed" },
  { name: "MultisigNotConfigured", code: 22, message: "Multisig not configured: call set_multisig_config() first" },
  { name: "NotASigner", code: 23, message: "Not a signer: you are not in the multisig signer list" },
  { name: "AlreadyApproved", code: 24, message: "Already approved: duplicate approval detected" },
  { name: "ThresholdNotMet", code: 25, message: "Threshold not met: insufficient approvals" },
  { name: "AlreadyExecuted", code: 26, message: "Already executed: this action has already been processed" },
  { name: "NotARoleHolder", code: 27, message: "Not a role holder: insufficient RBAC permissions" },
  { name: "AuditLogEmpty", code: 28, message: "Audit log empty: no entries recorded" },
  { name: "AuditEntryNotFound", code: 29, message: "Audit entry not found" },
  { name: "RecurringNotFound", code: 30, message: "Recurring payment not found" },
  { name: "RecurringNotDue", code: 31, message: "Recurring payment not yet due" },
  { name: "RecurringAlreadyCancelled", code: 32, message: "Recurring payment already cancelled" },
  { name: "RecurringExpired", code: 33, message: "Recurring payment expired: all payments completed" },
  { name: "FeeConfigNotFound", code: 34, message: "Fee configuration not found" },
  { name: "FeeTooHigh", code: 35, message: "Fee too high: exceeds maximum 1000 bps (10%)" },
  { name: "TimelockNotFound", code: 36, message: "Timelocked action not found" },
  { name: "TimelockNotDue", code: 37, message: "Timelocked action not yet due: 24-hour delay has not elapsed" },
  { name: "TimelockAlreadyExecuted", code: 38, message: "Timelocked action already executed" },
  { name: "GovernanceNotConfigured", code: 39, message: "Governance not configured: call configure_governance() first" },
  { name: "ProposalNotFound", code: 40, message: "Proposal not found" },
  { name: "VotingPeriodEnded", code: 41, message: "Voting period ended: proposal is closed" },
  { name: "ProposalAlreadyExecuted", code: 42, message: "Proposal already executed" },
  { name: "QuorumNotMet", code: 43, message: "Quorum not met: insufficient votes cast" },
  { name: "ProposalDefeated", code: 44, message: "Proposal defeated: no votes exceeded yes votes" },
  { name: "DepositTooLow", code: 45, message: "Deposit too low: must meet minimum proposal deposit" },
  { name: "SpendingLimitExpired", code: 46, message: "Spending limit expired: limit has been deactivated or expired" },
  { name: "RefundNotFound", code: 47, message: "Refund not found" },
  { name: "RefundAlreadyProcessed", code: 48, message: "Refund already processed" },
  { name: "PaymentAlreadyRefunded", code: 49, message: "Payment already refunded" },
  { name: "RefundWindowExpired", code: 50, message: "Refund window expired" },
  { name: "AlreadyVoted", code: 51, message: "Already voted: each address may vote only once per proposal" },
  { name: "ReentrantCall", code: 52, message: "Reentrant call detected: cross-contract reentry blocked" },
  { name: "SpendCapExceeded", code: 53, message: "Spending cap exceeded: total spend exceeds authorization" },
  { name: "DisputeAlreadyFiled", code: 54, message: "Dispute already filed: a dispute exists for this transaction" },
  { name: "DisputeNotFound", code: 55, message: "Dispute not found" },
  { name: "DisputeWindowExpired", code: 56, message: "Dispute window expired: too late to file a dispute" },
  { name: "RefundRejected", code: 57, message: "Refund rejected: refund request was denied" },
  { name: "InsufficientLiquidity", code: 58, message: "Insufficient liquidity: pool cannot fulfill the order" },
  { name: "AssetDepegged", code: 59, message: "Asset depegged: stablecoin is off its target peg" },
  { name: "ProposalNotPassed", code: 60, message: "Proposal not passed: insufficient yes votes" },
  { name: "InvalidSignature", code: 61, message: "Invalid signature: recovered signer does not match" },
  { name: "HookNotFound", code: 62, message: "Hook not found" },
  { name: "HookAlreadyExists", code: 63, message: "Hook already exists: duplicate hook registration" },
  { name: "RateLimitExceeded", code: 64, message: "Rate limit exceeded: too many requests" },
  { name: "AssetNotSupported", code: 65, message: "Asset not supported by this contract" },
  { name: "InvalidMetadataLength", code: 66, message: "Invalid metadata length: exceeds maximum allowed" },
  { name: "MaxRecipientsExceeded", code: 67, message: "Maximum recipients exceeded" },
  { name: "DuplicateRecipient", code: 68, message: "Duplicate recipient in batch" },
  { name: "StreamEndBeforeStart", code: 69, message: "Stream end time must be after start time" },
  { name: "EscrowDeadlineInPast", code: 70, message: "Escrow deadline must be in the future" },
  { name: "PendingOwnershipTransfer", code: 71, message: "Pending ownership transfer: accept or cancel first" },
  { name: "OwnershipTransferExpired", code: 72, message: "Ownership transfer expired: timelock elapsed without acceptance" },
  { name: "InvalidAddressFormat", code: 73, message: "Invalid address format" },
  { name: "BatchItemFailed", code: 74, message: "Batch item failed: individual payment in batch error" },
  { name: "RecurringScheduleInvalid", code: 75, message: "Invalid recurring schedule type" },
  { name: "FeeCollectorNotSet", code: 76, message: "Fee collector address not set" },
  { name: "EmitterNotLinked", code: 77, message: "Emitter contract not linked: call set_emitter() first" },
  { name: "ProposalDepositLocked", code: 78, message: "Proposal deposit is locked: cannot withdraw while voting" },
  { name: "MultisigSignerLimit", code: 79, message: "Multisig signer limit exceeded" },
  { name: "InvalidTokenContract", code: 80, message: "Invalid token contract address" },
  { name: "StorageLimitExceeded", code: 81, message: "Storage limit exceeded: contract storage is full" },
  { name: "ContractMigrationRequired", code: 82, message: "Contract migration required: upgrade to continue" },
  { name: "InvalidEventType", code: 83, message: "Invalid event type for notification hook" },
  { name: "WebhookUrlTooLong", code: 84, message: "Webhook URL too long: exceeds maximum length" },
  { name: "MaxHooksExceeded", code: 85, message: "Maximum notification hooks exceeded" },
  { name: "HookNotActive", code: 86, message: "Notification hook is not active" },
  { name: "CrossContractCallFailed", code: 87, message: "Cross-contract call failed" },
  { name: "InvalidScValEncoding", code: 88, message: "Invalid ScVal encoding in parameters" },
  { name: "UnsupportedOperation", code: 89, message: "Unsupported operation: not available in this version" },
  { name: "ContractNotLinked", code: 90, message: "Contract not linked: configure linked contract first" },
  { name: "MaxSignersExceeded", code: 91, message: "Maximum signers exceeded for multisig" },
  { name: "ZeroAddressNotAllowed", code: 92, message: "Zero address not allowed for this operation" },
  { name: "InvalidNetwork", code: 93, message: "Invalid network: wrong Stellar network configured" },
  { name: "StakingNotConfigured", code: 94, message: "Staking not configured: call configure_staking() first" },
  { name: "StakingAlreadyActive", code: 95, message: "Staking already active: cannot modify while staking" },
  { name: "RewardsPoolEmpty", code: 96, message: "Rewards pool empty: no rewards available for distribution" },
  { name: "UnstakingPeriodActive", code: 97, message: "Unstaking period active: funds are still in cooldown" },
  { name: "MinimumStakeNotMet", code: 98, message: "Minimum stake not met: stake must exceed the minimum" },
  { name: "MaximumStakeExceeded", code: 99, message: "Maximum stake exceeded: stake cannot exceed the cap" },
  { name: "RewardsAlreadyClaimed", code: 100, message: "Rewards already claimed for this epoch" },
  { name: "DelegationNotAllowed", code: 101, message: "Delegation not allowed: delegator is not authorized" },
  { name: "ValidatorNotActive", code: 102, message: "Validator not active: selected validator is offline" },
  { name: "SlashingConditionMet", code: 103, message: "Slashing condition met: stake is subject to penalty" },
  { name: "StakingPaused", code: 104, message: "Staking is currently paused" },
  { name: "CompoundRewardsFailed", code: 105, message: "Compound rewards failed: auto-compound error" },
  { name: "YieldTooLow", code: 106, message: "Yield too low: below minimum acceptable rate" },
  { name: "StakingPeriodNotEnded", code: 107, message: "Staking period not ended: cannot unstake yet" },
  { name: "RewardDistributionFailed", code: 108, message: "Reward distribution failed: transfer error" },
  { name: "UnauthorizedDelegator", code: 109, message: "Delegator not authorized for this validator" },
  { name: "BridgeNotConfigured", code: 110, message: "Bridge not configured: call configure_bridge() first" },
  { name: "BridgePaused", code: 111, message: "Bridge is currently paused" },
  { name: "InvalidSourceChain", code: 112, message: "Invalid source chain identifier" },
  { name: "InvalidDestinationChain", code: 113, message: "Invalid destination chain identifier" },
  { name: "CrossChainProofInvalid", code: 114, message: "Cross-chain proof invalid: verification failed" },
  { name: "BridgeRelayerNotSet", code: 115, message: "Bridge relayer not set: configure relayer address" },
  { name: "BridgeAmountTooLow", code: 116, message: "Bridge amount too low: below minimum transfer" },
  { name: "BridgeAmountTooHigh", code: 117, message: "Bridge amount too high: exceeds maximum transfer" },
  { name: "BridgeTransactionExpired", code: 118, message: "Bridge transaction expired: timeout reached" },
  { name: "UnsupportedTokenPair", code: 119, message: "Unsupported token pair for bridge transfer" },
  { name: "InsuranceFundNotConfigured", code: 120, message: "Insurance fund not configured" },
  { name: "InsuranceFundEmpty", code: 121, message: "Insurance fund empty: no funds available for claims" },
  { name: "InsuranceClaimAlreadyFiled", code: 122, message: "Insurance claim already filed for this event" },
  { name: "InsuranceClaimRejected", code: 123, message: "Insurance claim rejected: does not meet criteria" },
  { name: "InsuranceClaimWindowExpired", code: 124, message: "Insurance claim window expired" },
  { name: "CoverageLimitExceeded", code: 125, message: "Coverage limit exceeded: claim exceeds policy cap" },
  { name: "PremiumNotPaid", code: 126, message: "Premium not paid: insurance coverage is inactive" },
  { name: "RiskScoreTooHigh", code: 127, message: "Risk score too high: coverage denied" },
  { name: "UnderwritingFailed", code: 128, message: "Underwriting failed: risk assessment error" },
  { name: "InsurancePaused", code: 129, message: "Insurance operations are currently paused" },
  { name: "KYCNotCompleted", code: 130, message: "KYC not completed: identity verification required" },
  { name: "KYCTierTooLow", code: 131, message: "KYC tier too low: upgrade verification level" },
  { name: "AMLFlagRaised", code: 132, message: "AML flag raised: transaction blocked for review" },
  { name: "SanctionsListMatch", code: 133, message: "Sanctions list match: address is restricted" },
  { name: "IdentityVerificationFailed", code: 134, message: "Identity verification failed: documents invalid" },
  { name: "TravelRuleViolation", code: 135, message: "Travel rule violation: beneficiary info required" },
  { name: "JurisdictionNotSupported", code: 136, message: "Jurisdiction not supported for this operation" },
  { name: "ResidencyCheckFailed", code: 137, message: "Residency check failed: proof of residency required" },
  { name: "AccreditationRequired", code: 138, message: "Accreditation required: investor status not verified" },
  { name: "AgeVerificationFailed", code: 139, message: "Age verification failed: minimum age not met" },
  { name: "PaymentRouteNotFound", code: 140, message: "Payment route not found: no valid path" },
  { name: "PaymentSplitFailed", code: 141, message: "Payment split failed: distribution error" },
  { name: "SplitPercentageInvalid", code: 142, message: "Split percentage invalid: must sum to 100%" },
  { name: "RouteHopLimitExceeded", code: 143, message: "Route hop limit exceeded: path too long" },
  { name: "PathPaymentTooExpensive", code: 144, message: "Path payment too expensive: exceeds max fee" },
  { name: "LiquidityPoolNotFound", code: 145, message: "Liquidity pool not found for asset pair" },
  { name: "SlippageExceeded", code: 146, message: "Slippage exceeded: price moved beyond tolerance" },
  { name: "DeadlineExceeded", code: 147, message: "Deadline exceeded: transaction too old" },
  { name: "PriceOracleStale", code: 148, message: "Price oracle stale: last update too old" },
  { name: "FlashLoanNotRepaid", code: 149, message: "Flash loan not repaid in same transaction" },
  { name: "OutOfGas", code: 150, message: "Out of gas: computation budget exhausted" },
  { name: "GasPriceTooLow", code: 151, message: "Gas price too low: below network minimum" },
  { name: "GasRefundFailed", code: 152, message: "Gas refund failed: refund transfer error" },
  { name: "MemoryLimitExceeded", code: 153, message: "Memory limit exceeded: allocation too large" },
  { name: "StackDepthExceeded", code: 154, message: "Stack depth exceeded: too many nested calls" },
  { name: "InstructionBudgetExceeded", code: 155, message: "Instruction budget exceeded: too many operations" },
  { name: "ReadBudgetExceeded", code: 156, message: "Read budget exceeded: too many storage reads" },
  { name: "WriteBudgetExceeded", code: 157, message: "Write budget exceeded: too many storage writes" },
  { name: "TTLTooLow", code: 158, message: "TTL too low: entry would expire too soon" },
  { name: "LedgerEntryLimitReached", code: 159, message: "Ledger entry limit reached: cannot create more" },
  { name: "OracleNotConfigured", code: 160, message: "Oracle not configured: call set_oracle() first" },
  { name: "OracleTimeout", code: 161, message: "Oracle timeout: response took too long" },
  { name: "OraclePriceDeviation", code: 162, message: "Oracle price deviation: outlier detected" },
  { name: "DataFeedUnavailable", code: 163, message: "Data feed unavailable: source is offline" },
  { name: "DataFeedTampered", code: 164, message: "Data feed tampered: integrity check failed" },
  { name: "OracleAlreadyActive", code: 165, message: "Oracle already active: duplicate registration" },
  { name: "PriceFeedStale", code: 166, message: "Price feed stale: last update exceeds threshold" },
  { name: "ConfidenceIntervalTooWide", code: 167, message: "Confidence interval too wide: price uncertain" },
  { name: "OracleSignatureInvalid", code: 168, message: "Oracle signature invalid: attestation failed" },
  { name: "MaxPriceAgeExceeded", code: 169, message: "Maximum price age exceeded: feed too old" },
  { name: "BatchExecutionTimeout", code: 170, message: "Batch execution timeout: not all items finished" },
  { name: "BatchPartialFailure", code: 171, message: "Batch partial failure: some items failed" },
  { name: "StreamRateInvalid", code: 172, message: "Stream rate invalid: must be positive non-zero" },
  { name: "StreamTooLong", code: 173, message: "Stream duration too long: exceeds maximum" },
  { name: "StreamClaimTooEarly", code: 174, message: "Stream claim too early: minimum interval not met" },
  { name: "BatchAuthorizationFailed", code: 175, message: "Batch authorization failed: signer rejected" },
  { name: "BatchDuplicateId", code: 176, message: "Batch duplicate ID: transaction already processed" },
  { name: "StreamBeneficiaryUnchanged", code: 177, message: "Stream beneficiary unchanged: same as current" },
  { name: "StreamTransferNotAllowed", code: 178, message: "Stream transfer not allowed: stream is non-transferable" },
  { name: "BatchCleanupFailed", code: 179, message: "Batch cleanup failed: stale state removal error" },
  { name: "DisputeNotOpen", code: 180, message: "Dispute not open: no active dispute found" },
  { name: "DisputeArbiterNotSet", code: 181, message: "Dispute arbiter not set: configure arbiter first" },
  { name: "DisputeEvidenceRequired", code: 182, message: "Dispute evidence required: must submit proof" },
  { name: "DisputeAlreadyResolved", code: 183, message: "Dispute already resolved: final decision made" },
  { name: "DisputeResolutionTimedOut", code: 184, message: "Dispute resolution timed out: arbiter did not respond" },
  { name: "ArbiterNotAuthorized", code: 185, message: "Arbiter not authorized: not in approved list" },
  { name: "MediationFailed", code: 186, message: "Mediation failed: parties could not agree" },
  { name: "AppealWindowClosed", code: 187, message: "Appeal window closed: too late to appeal" },
  { name: "DisputeBondInsufficient", code: 188, message: "Dispute bond insufficient: must stake more" },
  { name: "DisputeEscalationFailed", code: 189, message: "Dispute escalation failed: higher authority error" },
  { name: "MaxStorageEntriesReached", code: 190, message: "Maximum storage entries reached: ledger full" },
  { name: "StorageFeeNotPaid", code: 191, message: "Storage fee not paid: rent payment required" },
  { name: "ArchiveEntryNotFound", code: 192, message: "Archive entry not found: record already pruned" },
  { name: "StateSyncMismatch", code: 193, message: "State sync mismatch: ledger state inconsistent" },
  { name: "MigrationInProgress", code: 194, message: "Migration in progress: try again later" },
  { name: "RollbackDetected", code: 195, message: "Rollback detected: chain reorganization" },
  { name: "SnapshotVerificationFailed", code: 196, message: "Snapshot verification failed: hash mismatch" },
  { name: "ContractDeprecated", code: 197, message: "Contract deprecated: use the new version" },
  { name: "EmergencyShutdownActive", code: 198, message: "Emergency shutdown active: all operations blocked" },
  { name: "SystemOverloaded", code: 199, message: "System overloaded: too many concurrent requests" },
  { name: "DelegateNotActive", code: 200, message: "Delegate not active: delegator is offline or disabled" },
  { name: "DelegationExpired", code: 201, message: "Delegation expired: delegation period has ended" },
  { name: "VoteDelegationMismatch", code: 202, message: "Vote delegation mismatch: delegate does not match voter" },
  { name: "ProposalCancelled", code: 203, message: "Proposal cancelled: proposal was withdrawn by creator" },
  { name: "ProposalQuorumChanged", code: 204, message: "Proposal quorum changed: quorum was modified mid-vote" },
  { name: "EmergencyGovernancePaused", code: 205, message: "Emergency governance paused: voting is temporarily suspended" },
  { name: "GovernanceTokenLocked", code: 206, message: "Governance token locked: tokens are in a lockup period" },
  { name: "VotingPowerFrozen", code: 207, message: "Voting power frozen: votes are immobilized by a freeze" },
  { name: "ProposalExecutionFailed", code: 208, message: "Proposal execution failed: on-chain execution reverted" },
  { name: "GovernanceUpgradePending", code: 209, message: "Governance upgrade pending: upgrade has not been finalized" },
  { name: "TreasuryNotConfigured", code: 210, message: "Treasury not configured: call configure_treasury() first" },
  { name: "TreasuryWithdrawalPending", code: 211, message: "Treasury withdrawal pending: timelock has not elapsed" },
  { name: "ReserveRequirementNotMet", code: 212, message: "Reserve requirement not met: minimum reserve ratio breached" },
  { name: "TreasuryMultisigRequired", code: 213, message: "Treasury multisig required: threshold signatures missing" },
  { name: "ReserveAssetUnavailable", code: 214, message: "Reserve asset unavailable: asset cannot be used as reserve" },
  { name: "TreasuryReportMismatch", code: 215, message: "Treasury report mismatch: balance does not match ledger" },
  { name: "ReserveRatioBreached", code: 216, message: "Reserve ratio breached: reserves fell below the minimum" },
  { name: "TreasuryAuditFailed", code: 217, message: "Treasury audit failed: reconciliation check did not pass" },
  { name: "ReserveRebalanceFailed", code: 218, message: "Reserve rebalance failed: allocation update reverted" },
  { name: "TreasuryAccessRevoked", code: 219, message: "Treasury access revoked: caller permissions were removed" },
  { name: "TokenAlreadyListed", code: 220, message: "Token already listed: asset is already supported" },
  { name: "TokenDelistingPending", code: 221, message: "Token delisting pending: removal is awaiting timelock" },
  { name: "AssetPairNotFound", code: 222, message: "Asset pair not found: no market exists for the pair" },
  { name: "TokenSupplyCapExceeded", code: 223, message: "Token supply cap exceeded: mint would exceed the cap" },
  { name: "MintingPaused", code: 224, message: "Minting paused: new issuance is temporarily disabled" },
  { name: "BurningPaused", code: 225, message: "Burning paused: token destruction is temporarily disabled" },
  { name: "TokenFrozen", code: 226, message: "Token frozen: asset transfers are blocked" },
  { name: "AssetTrustlineMissing", code: 227, message: "Asset trustline missing: trustline must be established" },
  { name: "TokenMetadataInvalid", code: 228, message: "Token metadata invalid: name, symbol, or decimals malformed" },
  { name: "AssetMigrationPending", code: 229, message: "Asset migration pending: upgrade to new contract incomplete" },
  { name: "LendingPoolNotConfigured", code: 230, message: "Lending pool not configured: call configure_lending() first" },
  { name: "LoanNotFound", code: 231, message: "Loan not found" },
  { name: "LoanAlreadyRepaid", code: 232, message: "Loan already repaid: no outstanding balance" },
  { name: "CollateralInsufficient", code: 233, message: "Collateral insufficient: below required ratio" },
  { name: "LiquidationPending", code: 234, message: "Liquidation pending: position is in the process of liquidation" },
  { name: "InterestRateInvalid", code: 235, message: "Interest rate invalid: outside allowed bounds" },
  { name: "CreditLimitExceeded", code: 236, message: "Credit limit exceeded: borrow would exceed the limit" },
  { name: "LoanMaturityReached", code: 237, message: "Loan maturity reached: repayment is now due" },
  { name: "CollateralFrozen", code: 238, message: "Collateral frozen: collateral cannot be moved" },
  { name: "LendingPaused", code: 239, message: "Lending paused: borrow and lend operations are suspended" },
  { name: "SubscriptionNotFound", code: 240, message: "Subscription not found" },
  { name: "SubscriptionAlreadyCancelled", code: 241, message: "Subscription already cancelled" },
  { name: "SubscriptionRenewalFailed", code: 242, message: "Subscription renewal failed: payment did not settle" },
  { name: "BillingCycleInvalid", code: 243, message: "Billing cycle invalid: interval is not supported" },
  { name: "SubscriptionPaused", code: 244, message: "Subscription paused: renewals are temporarily halted" },
  { name: "TrialPeriodExpired", code: 245, message: "Trial period expired: paid plan is now required" },
  { name: "PaymentMethodInvalid", code: 246, message: "Payment method invalid: token or method not accepted" },
  { name: "SubscriptionTierNotAllowed", code: 247, message: "Subscription tier not allowed: upgrade is restricted" },
  { name: "UsageQuotaExceeded", code: 248, message: "Usage quota exceeded: plan allowance has been reached" },
  { name: "SubscriptionUpgradePending", code: 249, message: "Subscription upgrade pending: change has not been applied" },
  { name: "ZkProofInvalid", code: 250, message: "Zero-knowledge proof invalid: verification failed" },
  { name: "PrivacyPoolNotConfigured", code: 251, message: "Privacy pool not configured: call configure_privacy() first" },
  { name: "CommitmentAlreadySpent", code: 252, message: "Commitment already spent: double-spend detected" },
  { name: "NullifierAlreadyUsed", code: 253, message: "Nullifier already used: proof was previously consumed" },
  { name: "MerklePathInvalid", code: 254, message: "Merkle path invalid: membership proof is malformed" },
  { name: "PrivacyDepositTooLow", code: 255, message: "Privacy deposit too low: below the minimum amount" },
  { name: "PrivacyWithdrawalPending", code: 256, message: "Privacy withdrawal pending: timelock has not elapsed" },
  { name: "StealthAddressInvalid", code: 257, message: "Stealth address invalid: cannot derive recipient" },
  { name: "ConfidentialTransferFailed", code: 258, message: "Confidential transfer failed: shielded amount mismatch" },
  { name: "PrivacyPaused", code: 259, message: "Privacy paused: shielded operations are suspended" },
  { name: "NotificationServiceDown", code: 260, message: "Notification service down: delivery backend unavailable" },
  { name: "MessageTooLong", code: 261, message: "Message too long: exceeds maximum length" },
  { name: "RecipientUnsubscribed", code: 262, message: "Recipient unsubscribed: target has opted out" },
  { name: "NotificationDeliveryFailed", code: 263, message: "Notification delivery failed: could not reach recipient" },
  { name: "NotificationRateLimited", code: 264, message: "Notification rate limited: too many messages sent" },
  { name: "MessageSignatureInvalid", code: 265, message: "Message signature invalid: sender could not be verified" },
  { name: "InboxFull", code: 266, message: "Inbox full: recipient storage limit reached" },
  { name: "NotificationTemplateInvalid", code: 267, message: "Notification template invalid: malformed payload" },
  { name: "MessageExpired", code: 268, message: "Message expired: delivery window has passed" },
  { name: "NotificationChannelClosed", code: 269, message: "Notification channel closed: channel is no longer active" },
  { name: "ReportGenerationFailed", code: 270, message: "Report generation failed: aggregation error" },
  { name: "AnalyticsDataMissing", code: 271, message: "Analytics data missing: required metrics unavailable" },
  { name: "MetricOutOfRange", code: 272, message: "Metric out of range: value exceeds allowed bounds" },
  { name: "ReportTooLarge", code: 273, message: "Report too large: exceeds maximum output size" },
  { name: "SnapshotNotFound", code: 274, message: "Snapshot not found: requested point-in-time state missing" },
  { name: "AggregationWindowInvalid", code: 275, message: "Aggregation window invalid: time range is malformed" },
  { name: "DataRetentionExpired", code: 276, message: "Data retention expired: historical data was pruned" },
  { name: "ReportAccessDenied", code: 277, message: "Report access denied: insufficient permissions" },
  { name: "AnalyticsQuotaExceeded", code: 278, message: "Analytics quota exceeded: too many report requests" },
  { name: "ExportFormatUnsupported", code: 279, message: "Export format unsupported: requested format is not available" },
  { name: "SepProtocolViolation", code: 280, message: "SEP protocol violation: interface contract was not honored" },
  { name: "AssetNotSepCompliant", code: 281, message: "Asset not SEP-compliant: missing required SEP behavior" },
  { name: "CrossContractVersionMismatch", code: 282, message: "Cross-contract version mismatch: incompatible API versions" },
  { name: "InterfaceNotImplemented", code: 283, message: "Interface not implemented: required method is missing" },
  { name: "StandardsComplianceFailed", code: 284, message: "Standards compliance failed: validation did not pass" },
  { name: "ProtocolUpgradeRequired", code: 285, message: "Protocol upgrade required: dependency is out of date" },
  { name: "InteropHandshakeFailed", code: 286, message: "Interop handshake failed: connection could not be established" },
  { name: "NamespaceCollision", code: 287, message: "Namespace collision: identifier is already registered" },
  { name: "ExternalSystemUnavailable", code: 288, message: "External system unavailable: dependency is offline" },
  { name: "InteropRateLimitExceeded", code: 289, message: "Interop rate limit exceeded: too many cross-system calls" },
  { name: "ContractUpgradeScheduled", code: 290, message: "Contract upgrade scheduled: upgrade is pending execution" },
  { name: "MaintenanceModeActive", code: 291, message: "Maintenance mode active: operations temporarily disabled" },
  { name: "CircuitBreakerTripped", code: 292, message: "Circuit breaker tripped: safety threshold was exceeded" },
  { name: "EmergencyFreezeActive", code: 293, message: "Emergency freeze active: all state changes are blocked" },
  { name: "SystemClockDriftDetected", code: 294, message: "System clock drift detected: ledger time is inconsistent" },
  { name: "LedgerVersionUnsupported", code: 295, message: "Ledger version unsupported: network upgrade required" },
  { name: "NetworkPartitionDetected", code: 296, message: "Network partition detected: consensus is unavailable" },
  { name: "ResourceExhaustionWarning", code: 297, message: "Resource exhaustion warning: limits are near capacity" },
  { name: "GracePeriodActive", code: 298, message: "Grace period active: transitional restrictions in effect" },
  { name: "ConfigurationInvalid", code: 299, message: "Configuration invalid: stored configuration is malformed" },
  { name: "SystemFatalError", code: 300, message: "System fatal error: unrecoverable internal failure" },
  { name: "RevocationNotFound", code: 301, message: "Revocation not found" },
  { name: "RevocationNotDue", code: 302, message: "Revocation not due" },
  { name: "RevocationAlreadyExecuted", code: 303, message: "Revocation already executed" },
  { name: "CannotRevokeSelf", code: 304, message: "Cannot revoke self" },
  { name: "NoPendingOwner", code: 305, message: "No pending ownership transfer" },
  { name: "MathOverflow", code: 306, message: "Math overflow" },
  { name: "StreamInvariantViolated", code: 307, message: "Stream accounting invariant violated: refused to pay an inconsistent amount" },
  { name: "InvalidPauseScope", code: 308, message: "Pause scope not recognized: unknown scope identifier" },
  { name: "PaymentIdempotencyConflict", code: 309, message: "Idempotency key was reused for a different payment payload" },
];
