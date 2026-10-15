// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run `npm run generate-errors` to update.

/**
 * Soroban contract error type definitions and TypeScript enum mirroring.
 * 1:1 mirroring of PaymentError in contracts/ophirpay/src/errors.rs.
 */

export enum PaymentErrorCode {
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

export type PaymentErrorName =
  | "NotInitialized"
  | "AlreadyInitialized"
  | "PaymentNotFound"
  | "Unauthorized"
  | "InvalidAmount"
  | "EscrowNotDue"
  | "EscrowAlreadyReleased"
  | "EscrowNotFound"
  | "StreamNotStarted"
  | "StreamAlreadyCancelled"
  | "StreamNotFound"
  | "StreamFullyClaimed"
  | "BatchTooLarge"
  | "BatchEmpty"
  | "TokenTransferFailed"
  | "InsufficientBalance"
  | "PaymentAlreadyCancelled"
  | "ContractPaused"
  | "NoTokensToWithdraw"
  | "UpgradeNotProposed"
  | "UpgradeTimelockActive"
  | "MultisigNotConfigured"
  | "NotASigner"
  | "AlreadyApproved"
  | "ThresholdNotMet"
  | "AlreadyExecuted"
  | "NotARoleHolder"
  | "AuditLogEmpty"
  | "AuditEntryNotFound"
  | "RecurringNotFound"
  | "RecurringNotDue"
  | "RecurringAlreadyCancelled"
  | "RecurringExpired"
  | "FeeConfigNotFound"
  | "FeeTooHigh"
  | "TimelockNotFound"
  | "TimelockNotDue"
  | "TimelockAlreadyExecuted"
  | "GovernanceNotConfigured"
  | "ProposalNotFound"
  | "VotingPeriodEnded"
  | "ProposalAlreadyExecuted"
  | "QuorumNotMet"
  | "ProposalDefeated"
  | "DepositTooLow"
  | "SpendingLimitExpired"
  | "RefundNotFound"
  | "RefundAlreadyProcessed"
  | "PaymentAlreadyRefunded"
  | "RefundWindowExpired"
  | "AlreadyVoted"
  | "ReentrantCall"
  | "SpendCapExceeded"
  | "DisputeAlreadyFiled"
  | "DisputeNotFound"
  | "DisputeWindowExpired"
  | "RefundRejected"
  | "InsufficientLiquidity"
  | "AssetDepegged"
  | "ProposalNotPassed"
  | "InvalidSignature"
  | "HookNotFound"
  | "HookAlreadyExists"
  | "RateLimitExceeded"
  | "AssetNotSupported"
  | "InvalidMetadataLength"
  | "MaxRecipientsExceeded"
  | "DuplicateRecipient"
  | "StreamEndBeforeStart"
  | "EscrowDeadlineInPast"
  | "PendingOwnershipTransfer"
  | "OwnershipTransferExpired"
  | "InvalidAddressFormat"
  | "BatchItemFailed"
  | "RecurringScheduleInvalid"
  | "FeeCollectorNotSet"
  | "EmitterNotLinked"
  | "ProposalDepositLocked"
  | "MultisigSignerLimit"
  | "InvalidTokenContract"
  | "StorageLimitExceeded"
  | "ContractMigrationRequired"
  | "InvalidEventType"
  | "WebhookUrlTooLong"
  | "MaxHooksExceeded"
  | "HookNotActive"
  | "CrossContractCallFailed"
  | "InvalidScValEncoding"
  | "UnsupportedOperation"
  | "ContractNotLinked"
  | "MaxSignersExceeded"
  | "ZeroAddressNotAllowed"
  | "InvalidNetwork"
  | "StakingNotConfigured"
  | "StakingAlreadyActive"
  | "RewardsPoolEmpty"
  | "UnstakingPeriodActive"
  | "MinimumStakeNotMet"
  | "MaximumStakeExceeded"
  | "RewardsAlreadyClaimed"
  | "DelegationNotAllowed"
  | "ValidatorNotActive"
  | "SlashingConditionMet"
  | "StakingPaused"
  | "CompoundRewardsFailed"
  | "YieldTooLow"
  | "StakingPeriodNotEnded"
  | "RewardDistributionFailed"
  | "UnauthorizedDelegator"
  | "BridgeNotConfigured"
  | "BridgePaused"
  | "InvalidSourceChain"
  | "InvalidDestinationChain"
  | "CrossChainProofInvalid"
  | "BridgeRelayerNotSet"
  | "BridgeAmountTooLow"
  | "BridgeAmountTooHigh"
  | "BridgeTransactionExpired"
  | "UnsupportedTokenPair"
  | "InsuranceFundNotConfigured"
  | "InsuranceFundEmpty"
  | "InsuranceClaimAlreadyFiled"
  | "InsuranceClaimRejected"
  | "InsuranceClaimWindowExpired"
  | "CoverageLimitExceeded"
  | "PremiumNotPaid"
  | "RiskScoreTooHigh"
  | "UnderwritingFailed"
  | "InsurancePaused"
  | "KYCNotCompleted"
  | "KYCTierTooLow"
  | "AMLFlagRaised"
  | "SanctionsListMatch"
  | "IdentityVerificationFailed"
  | "TravelRuleViolation"
  | "JurisdictionNotSupported"
  | "ResidencyCheckFailed"
  | "AccreditationRequired"
  | "AgeVerificationFailed"
  | "PaymentRouteNotFound"
  | "PaymentSplitFailed"
  | "SplitPercentageInvalid"
  | "RouteHopLimitExceeded"
  | "PathPaymentTooExpensive"
  | "LiquidityPoolNotFound"
  | "SlippageExceeded"
  | "DeadlineExceeded"
  | "PriceOracleStale"
  | "FlashLoanNotRepaid"
  | "OutOfGas"
  | "GasPriceTooLow"
  | "GasRefundFailed"
  | "MemoryLimitExceeded"
  | "StackDepthExceeded"
  | "InstructionBudgetExceeded"
  | "ReadBudgetExceeded"
  | "WriteBudgetExceeded"
  | "TTLTooLow"
  | "LedgerEntryLimitReached"
  | "OracleNotConfigured"
  | "OracleTimeout"
  | "OraclePriceDeviation"
  | "DataFeedUnavailable"
  | "DataFeedTampered"
  | "OracleAlreadyActive"
  | "PriceFeedStale"
  | "ConfidenceIntervalTooWide"
  | "OracleSignatureInvalid"
  | "MaxPriceAgeExceeded"
  | "BatchExecutionTimeout"
  | "BatchPartialFailure"
  | "StreamRateInvalid"
  | "StreamTooLong"
  | "StreamClaimTooEarly"
  | "BatchAuthorizationFailed"
  | "BatchDuplicateId"
  | "StreamBeneficiaryUnchanged"
  | "StreamTransferNotAllowed"
  | "BatchCleanupFailed"
  | "DisputeNotOpen"
  | "DisputeArbiterNotSet"
  | "DisputeEvidenceRequired"
  | "DisputeAlreadyResolved"
  | "DisputeResolutionTimedOut"
  | "ArbiterNotAuthorized"
  | "MediationFailed"
  | "AppealWindowClosed"
  | "DisputeBondInsufficient"
  | "DisputeEscalationFailed"
  | "MaxStorageEntriesReached"
  | "StorageFeeNotPaid"
  | "ArchiveEntryNotFound"
  | "StateSyncMismatch"
  | "MigrationInProgress"
  | "RollbackDetected"
  | "SnapshotVerificationFailed"
  | "ContractDeprecated"
  | "EmergencyShutdownActive"
  | "SystemOverloaded"
  | "DelegateNotActive"
  | "DelegationExpired"
  | "VoteDelegationMismatch"
  | "ProposalCancelled"
  | "ProposalQuorumChanged"
  | "EmergencyGovernancePaused"
  | "GovernanceTokenLocked"
  | "VotingPowerFrozen"
  | "ProposalExecutionFailed"
  | "GovernanceUpgradePending"
  | "TreasuryNotConfigured"
  | "TreasuryWithdrawalPending"
  | "ReserveRequirementNotMet"
  | "TreasuryMultisigRequired"
  | "ReserveAssetUnavailable"
  | "TreasuryReportMismatch"
  | "ReserveRatioBreached"
  | "TreasuryAuditFailed"
  | "ReserveRebalanceFailed"
  | "TreasuryAccessRevoked"
  | "TokenAlreadyListed"
  | "TokenDelistingPending"
  | "AssetPairNotFound"
  | "TokenSupplyCapExceeded"
  | "MintingPaused"
  | "BurningPaused"
  | "TokenFrozen"
  | "AssetTrustlineMissing"
  | "TokenMetadataInvalid"
  | "AssetMigrationPending"
  | "LendingPoolNotConfigured"
  | "LoanNotFound"
  | "LoanAlreadyRepaid"
  | "CollateralInsufficient"
  | "LiquidationPending"
  | "InterestRateInvalid"
  | "CreditLimitExceeded"
  | "LoanMaturityReached"
  | "CollateralFrozen"
  | "LendingPaused"
  | "SubscriptionNotFound"
  | "SubscriptionAlreadyCancelled"
  | "SubscriptionRenewalFailed"
  | "BillingCycleInvalid"
  | "SubscriptionPaused"
  | "TrialPeriodExpired"
  | "PaymentMethodInvalid"
  | "SubscriptionTierNotAllowed"
  | "UsageQuotaExceeded"
  | "SubscriptionUpgradePending"
  | "ZkProofInvalid"
  | "PrivacyPoolNotConfigured"
  | "CommitmentAlreadySpent"
  | "NullifierAlreadyUsed"
  | "MerklePathInvalid"
  | "PrivacyDepositTooLow"
  | "PrivacyWithdrawalPending"
  | "StealthAddressInvalid"
  | "ConfidentialTransferFailed"
  | "PrivacyPaused"
  | "NotificationServiceDown"
  | "MessageTooLong"
  | "RecipientUnsubscribed"
  | "NotificationDeliveryFailed"
  | "NotificationRateLimited"
  | "MessageSignatureInvalid"
  | "InboxFull"
  | "NotificationTemplateInvalid"
  | "MessageExpired"
  | "NotificationChannelClosed"
  | "ReportGenerationFailed"
  | "AnalyticsDataMissing"
  | "MetricOutOfRange"
  | "ReportTooLarge"
  | "SnapshotNotFound"
  | "AggregationWindowInvalid"
  | "DataRetentionExpired"
  | "ReportAccessDenied"
  | "AnalyticsQuotaExceeded"
  | "ExportFormatUnsupported"
  | "SepProtocolViolation"
  | "AssetNotSepCompliant"
  | "CrossContractVersionMismatch"
  | "InterfaceNotImplemented"
  | "StandardsComplianceFailed"
  | "ProtocolUpgradeRequired"
  | "InteropHandshakeFailed"
  | "NamespaceCollision"
  | "ExternalSystemUnavailable"
  | "InteropRateLimitExceeded"
  | "ContractUpgradeScheduled"
  | "MaintenanceModeActive"
  | "CircuitBreakerTripped"
  | "EmergencyFreezeActive"
  | "SystemClockDriftDetected"
  | "LedgerVersionUnsupported"
  | "NetworkPartitionDetected"
  | "ResourceExhaustionWarning"
  | "GracePeriodActive"
  | "ConfigurationInvalid"
  | "SystemFatalError"
  | "RevocationNotFound"
  | "RevocationNotDue"
  | "RevocationAlreadyExecuted"
  | "CannotRevokeSelf"
  | "NoPendingOwner"
  | "MathOverflow"
  | "StreamInvariantViolated"
  | "InvalidPauseScope"
  | "PaymentIdempotencyConflict"
;

export interface PaymentErrorDefinition {
  code: PaymentErrorCode;
  name: PaymentErrorName;
  message: string;
}

export const PAYMENT_ERROR_DEFINITIONS: Record<number, PaymentErrorDefinition> = {
  [PaymentErrorCode.NotInitialized]: {
    code: PaymentErrorCode.NotInitialized,
    name: "NotInitialized",
    message: "Contract not initialized: call init() first",
  },
  [PaymentErrorCode.AlreadyInitialized]: {
    code: PaymentErrorCode.AlreadyInitialized,
    name: "AlreadyInitialized",
    message: "Contract already initialized",
  },
  [PaymentErrorCode.PaymentNotFound]: {
    code: PaymentErrorCode.PaymentNotFound,
    name: "PaymentNotFound",
    message: "Payment not found",
  },
  [PaymentErrorCode.Unauthorized]: {
    code: PaymentErrorCode.Unauthorized,
    name: "Unauthorized",
    message: "Unauthorized: caller does not have permission",
  },
  [PaymentErrorCode.InvalidAmount]: {
    code: PaymentErrorCode.InvalidAmount,
    name: "InvalidAmount",
    message: "Invalid amount: must be greater than zero",
  },
  [PaymentErrorCode.EscrowNotDue]: {
    code: PaymentErrorCode.EscrowNotDue,
    name: "EscrowNotDue",
    message: "Escrow not yet due: deadline has not passed",
  },
  [PaymentErrorCode.EscrowAlreadyReleased]: {
    code: PaymentErrorCode.EscrowAlreadyReleased,
    name: "EscrowAlreadyReleased",
    message: "Escrow already released",
  },
  [PaymentErrorCode.EscrowNotFound]: {
    code: PaymentErrorCode.EscrowNotFound,
    name: "EscrowNotFound",
    message: "Escrow not found",
  },
  [PaymentErrorCode.StreamNotStarted]: {
    code: PaymentErrorCode.StreamNotStarted,
    name: "StreamNotStarted",
    message: "Stream not started: start time is in the future",
  },
  [PaymentErrorCode.StreamAlreadyCancelled]: {
    code: PaymentErrorCode.StreamAlreadyCancelled,
    name: "StreamAlreadyCancelled",
    message: "Stream already cancelled",
  },
  [PaymentErrorCode.StreamNotFound]: {
    code: PaymentErrorCode.StreamNotFound,
    name: "StreamNotFound",
    message: "Stream not found",
  },
  [PaymentErrorCode.StreamFullyClaimed]: {
    code: PaymentErrorCode.StreamFullyClaimed,
    name: "StreamFullyClaimed",
    message: "Stream fully claimed: no remaining balance",
  },
  [PaymentErrorCode.BatchTooLarge]: {
    code: PaymentErrorCode.BatchTooLarge,
    name: "BatchTooLarge",
    message: "Batch too large: exceeds maximum recipients",
  },
  [PaymentErrorCode.BatchEmpty]: {
    code: PaymentErrorCode.BatchEmpty,
    name: "BatchEmpty",
    message: "Batch empty: no recipients provided",
  },
  [PaymentErrorCode.TokenTransferFailed]: {
    code: PaymentErrorCode.TokenTransferFailed,
    name: "TokenTransferFailed",
    message: "Token transfer failed",
  },
  [PaymentErrorCode.InsufficientBalance]: {
    code: PaymentErrorCode.InsufficientBalance,
    name: "InsufficientBalance",
    message: "Insufficient balance to cover payment",
  },
  [PaymentErrorCode.PaymentAlreadyCancelled]: {
    code: PaymentErrorCode.PaymentAlreadyCancelled,
    name: "PaymentAlreadyCancelled",
    message: "Payment already cancelled",
  },
  [PaymentErrorCode.ContractPaused]: {
    code: PaymentErrorCode.ContractPaused,
    name: "ContractPaused",
    message: "Contract paused: operations are temporarily disabled",
  },
  [PaymentErrorCode.NoTokensToWithdraw]: {
    code: PaymentErrorCode.NoTokensToWithdraw,
    name: "NoTokensToWithdraw",
    message: "No tokens available to withdraw",
  },
  [PaymentErrorCode.UpgradeNotProposed]: {
    code: PaymentErrorCode.UpgradeNotProposed,
    name: "UpgradeNotProposed",
    message: "Upgrade not proposed: call propose_upgrade() first",
  },
  [PaymentErrorCode.UpgradeTimelockActive]: {
    code: PaymentErrorCode.UpgradeTimelockActive,
    name: "UpgradeTimelockActive",
    message: "Upgrade timelock active: 24-hour delay has not elapsed",
  },
  [PaymentErrorCode.MultisigNotConfigured]: {
    code: PaymentErrorCode.MultisigNotConfigured,
    name: "MultisigNotConfigured",
    message: "Multisig not configured: call set_multisig_config() first",
  },
  [PaymentErrorCode.NotASigner]: {
    code: PaymentErrorCode.NotASigner,
    name: "NotASigner",
    message: "Not a signer: you are not in the multisig signer list",
  },
  [PaymentErrorCode.AlreadyApproved]: {
    code: PaymentErrorCode.AlreadyApproved,
    name: "AlreadyApproved",
    message: "Already approved: duplicate approval detected",
  },
  [PaymentErrorCode.ThresholdNotMet]: {
    code: PaymentErrorCode.ThresholdNotMet,
    name: "ThresholdNotMet",
    message: "Threshold not met: insufficient approvals",
  },
  [PaymentErrorCode.AlreadyExecuted]: {
    code: PaymentErrorCode.AlreadyExecuted,
    name: "AlreadyExecuted",
    message: "Already executed: this action has already been processed",
  },
  [PaymentErrorCode.NotARoleHolder]: {
    code: PaymentErrorCode.NotARoleHolder,
    name: "NotARoleHolder",
    message: "Not a role holder: insufficient RBAC permissions",
  },
  [PaymentErrorCode.AuditLogEmpty]: {
    code: PaymentErrorCode.AuditLogEmpty,
    name: "AuditLogEmpty",
    message: "Audit log empty: no entries recorded",
  },
  [PaymentErrorCode.AuditEntryNotFound]: {
    code: PaymentErrorCode.AuditEntryNotFound,
    name: "AuditEntryNotFound",
    message: "Audit entry not found",
  },
  [PaymentErrorCode.RecurringNotFound]: {
    code: PaymentErrorCode.RecurringNotFound,
    name: "RecurringNotFound",
    message: "Recurring payment not found",
  },
  [PaymentErrorCode.RecurringNotDue]: {
    code: PaymentErrorCode.RecurringNotDue,
    name: "RecurringNotDue",
    message: "Recurring payment not yet due",
  },
  [PaymentErrorCode.RecurringAlreadyCancelled]: {
    code: PaymentErrorCode.RecurringAlreadyCancelled,
    name: "RecurringAlreadyCancelled",
    message: "Recurring payment already cancelled",
  },
  [PaymentErrorCode.RecurringExpired]: {
    code: PaymentErrorCode.RecurringExpired,
    name: "RecurringExpired",
    message: "Recurring payment expired: all payments completed",
  },
  [PaymentErrorCode.FeeConfigNotFound]: {
    code: PaymentErrorCode.FeeConfigNotFound,
    name: "FeeConfigNotFound",
    message: "Fee configuration not found",
  },
  [PaymentErrorCode.FeeTooHigh]: {
    code: PaymentErrorCode.FeeTooHigh,
    name: "FeeTooHigh",
    message: "Fee too high: exceeds maximum 1000 bps (10%)",
  },
  [PaymentErrorCode.TimelockNotFound]: {
    code: PaymentErrorCode.TimelockNotFound,
    name: "TimelockNotFound",
    message: "Timelocked action not found",
  },
  [PaymentErrorCode.TimelockNotDue]: {
    code: PaymentErrorCode.TimelockNotDue,
    name: "TimelockNotDue",
    message: "Timelocked action not yet due: 24-hour delay has not elapsed",
  },
  [PaymentErrorCode.TimelockAlreadyExecuted]: {
    code: PaymentErrorCode.TimelockAlreadyExecuted,
    name: "TimelockAlreadyExecuted",
    message: "Timelocked action already executed",
  },
  [PaymentErrorCode.GovernanceNotConfigured]: {
    code: PaymentErrorCode.GovernanceNotConfigured,
    name: "GovernanceNotConfigured",
    message: "Governance not configured: call configure_governance() first",
  },
  [PaymentErrorCode.ProposalNotFound]: {
    code: PaymentErrorCode.ProposalNotFound,
    name: "ProposalNotFound",
    message: "Proposal not found",
  },
  [PaymentErrorCode.VotingPeriodEnded]: {
    code: PaymentErrorCode.VotingPeriodEnded,
    name: "VotingPeriodEnded",
    message: "Voting period ended: proposal is closed",
  },
  [PaymentErrorCode.ProposalAlreadyExecuted]: {
    code: PaymentErrorCode.ProposalAlreadyExecuted,
    name: "ProposalAlreadyExecuted",
    message: "Proposal already executed",
  },
  [PaymentErrorCode.QuorumNotMet]: {
    code: PaymentErrorCode.QuorumNotMet,
    name: "QuorumNotMet",
    message: "Quorum not met: insufficient votes cast",
  },
  [PaymentErrorCode.ProposalDefeated]: {
    code: PaymentErrorCode.ProposalDefeated,
    name: "ProposalDefeated",
    message: "Proposal defeated: no votes exceeded yes votes",
  },
  [PaymentErrorCode.DepositTooLow]: {
    code: PaymentErrorCode.DepositTooLow,
    name: "DepositTooLow",
    message: "Deposit too low: must meet minimum proposal deposit",
  },
  [PaymentErrorCode.SpendingLimitExpired]: {
    code: PaymentErrorCode.SpendingLimitExpired,
    name: "SpendingLimitExpired",
    message: "Spending limit expired: limit has been deactivated or expired",
  },
  [PaymentErrorCode.RefundNotFound]: {
    code: PaymentErrorCode.RefundNotFound,
    name: "RefundNotFound",
    message: "Refund not found",
  },
  [PaymentErrorCode.RefundAlreadyProcessed]: {
    code: PaymentErrorCode.RefundAlreadyProcessed,
    name: "RefundAlreadyProcessed",
    message: "Refund already processed",
  },
  [PaymentErrorCode.PaymentAlreadyRefunded]: {
    code: PaymentErrorCode.PaymentAlreadyRefunded,
    name: "PaymentAlreadyRefunded",
    message: "Payment already refunded",
  },
  [PaymentErrorCode.RefundWindowExpired]: {
    code: PaymentErrorCode.RefundWindowExpired,
    name: "RefundWindowExpired",
    message: "Refund window expired",
  },
  [PaymentErrorCode.AlreadyVoted]: {
    code: PaymentErrorCode.AlreadyVoted,
    name: "AlreadyVoted",
    message: "Already voted: each address may vote only once per proposal",
  },
  [PaymentErrorCode.ReentrantCall]: {
    code: PaymentErrorCode.ReentrantCall,
    name: "ReentrantCall",
    message: "Reentrant call detected: cross-contract reentry blocked",
  },
  [PaymentErrorCode.SpendCapExceeded]: {
    code: PaymentErrorCode.SpendCapExceeded,
    name: "SpendCapExceeded",
    message: "Spending cap exceeded: total spend exceeds authorization",
  },
  [PaymentErrorCode.DisputeAlreadyFiled]: {
    code: PaymentErrorCode.DisputeAlreadyFiled,
    name: "DisputeAlreadyFiled",
    message: "Dispute already filed: a dispute exists for this transaction",
  },
  [PaymentErrorCode.DisputeNotFound]: {
    code: PaymentErrorCode.DisputeNotFound,
    name: "DisputeNotFound",
    message: "Dispute not found",
  },
  [PaymentErrorCode.DisputeWindowExpired]: {
    code: PaymentErrorCode.DisputeWindowExpired,
    name: "DisputeWindowExpired",
    message: "Dispute window expired: too late to file a dispute",
  },
  [PaymentErrorCode.RefundRejected]: {
    code: PaymentErrorCode.RefundRejected,
    name: "RefundRejected",
    message: "Refund rejected: refund request was denied",
  },
  [PaymentErrorCode.InsufficientLiquidity]: {
    code: PaymentErrorCode.InsufficientLiquidity,
    name: "InsufficientLiquidity",
    message: "Insufficient liquidity: pool cannot fulfill the order",
  },
  [PaymentErrorCode.AssetDepegged]: {
    code: PaymentErrorCode.AssetDepegged,
    name: "AssetDepegged",
    message: "Asset depegged: stablecoin is off its target peg",
  },
  [PaymentErrorCode.ProposalNotPassed]: {
    code: PaymentErrorCode.ProposalNotPassed,
    name: "ProposalNotPassed",
    message: "Proposal not passed: insufficient yes votes",
  },
  [PaymentErrorCode.InvalidSignature]: {
    code: PaymentErrorCode.InvalidSignature,
    name: "InvalidSignature",
    message: "Invalid signature: recovered signer does not match",
  },
  [PaymentErrorCode.HookNotFound]: {
    code: PaymentErrorCode.HookNotFound,
    name: "HookNotFound",
    message: "Hook not found",
  },
  [PaymentErrorCode.HookAlreadyExists]: {
    code: PaymentErrorCode.HookAlreadyExists,
    name: "HookAlreadyExists",
    message: "Hook already exists: duplicate hook registration",
  },
  [PaymentErrorCode.RateLimitExceeded]: {
    code: PaymentErrorCode.RateLimitExceeded,
    name: "RateLimitExceeded",
    message: "Rate limit exceeded: too many requests",
  },
  [PaymentErrorCode.AssetNotSupported]: {
    code: PaymentErrorCode.AssetNotSupported,
    name: "AssetNotSupported",
    message: "Asset not supported by this contract",
  },
  [PaymentErrorCode.InvalidMetadataLength]: {
    code: PaymentErrorCode.InvalidMetadataLength,
    name: "InvalidMetadataLength",
    message: "Invalid metadata length: exceeds maximum allowed",
  },
  [PaymentErrorCode.MaxRecipientsExceeded]: {
    code: PaymentErrorCode.MaxRecipientsExceeded,
    name: "MaxRecipientsExceeded",
    message: "Maximum recipients exceeded",
  },
  [PaymentErrorCode.DuplicateRecipient]: {
    code: PaymentErrorCode.DuplicateRecipient,
    name: "DuplicateRecipient",
    message: "Duplicate recipient in batch",
  },
  [PaymentErrorCode.StreamEndBeforeStart]: {
    code: PaymentErrorCode.StreamEndBeforeStart,
    name: "StreamEndBeforeStart",
    message: "Stream end time must be after start time",
  },
  [PaymentErrorCode.EscrowDeadlineInPast]: {
    code: PaymentErrorCode.EscrowDeadlineInPast,
    name: "EscrowDeadlineInPast",
    message: "Escrow deadline must be in the future",
  },
  [PaymentErrorCode.PendingOwnershipTransfer]: {
    code: PaymentErrorCode.PendingOwnershipTransfer,
    name: "PendingOwnershipTransfer",
    message: "Pending ownership transfer: accept or cancel first",
  },
  [PaymentErrorCode.OwnershipTransferExpired]: {
    code: PaymentErrorCode.OwnershipTransferExpired,
    name: "OwnershipTransferExpired",
    message: "Ownership transfer expired: timelock elapsed without acceptance",
  },
  [PaymentErrorCode.InvalidAddressFormat]: {
    code: PaymentErrorCode.InvalidAddressFormat,
    name: "InvalidAddressFormat",
    message: "Invalid address format",
  },
  [PaymentErrorCode.BatchItemFailed]: {
    code: PaymentErrorCode.BatchItemFailed,
    name: "BatchItemFailed",
    message: "Batch item failed: individual payment in batch error",
  },
  [PaymentErrorCode.RecurringScheduleInvalid]: {
    code: PaymentErrorCode.RecurringScheduleInvalid,
    name: "RecurringScheduleInvalid",
    message: "Invalid recurring schedule type",
  },
  [PaymentErrorCode.FeeCollectorNotSet]: {
    code: PaymentErrorCode.FeeCollectorNotSet,
    name: "FeeCollectorNotSet",
    message: "Fee collector address not set",
  },
  [PaymentErrorCode.EmitterNotLinked]: {
    code: PaymentErrorCode.EmitterNotLinked,
    name: "EmitterNotLinked",
    message: "Emitter contract not linked: call set_emitter() first",
  },
  [PaymentErrorCode.ProposalDepositLocked]: {
    code: PaymentErrorCode.ProposalDepositLocked,
    name: "ProposalDepositLocked",
    message: "Proposal deposit is locked: cannot withdraw while voting",
  },
  [PaymentErrorCode.MultisigSignerLimit]: {
    code: PaymentErrorCode.MultisigSignerLimit,
    name: "MultisigSignerLimit",
    message: "Multisig signer limit exceeded",
  },
  [PaymentErrorCode.InvalidTokenContract]: {
    code: PaymentErrorCode.InvalidTokenContract,
    name: "InvalidTokenContract",
    message: "Invalid token contract address",
  },
  [PaymentErrorCode.StorageLimitExceeded]: {
    code: PaymentErrorCode.StorageLimitExceeded,
    name: "StorageLimitExceeded",
    message: "Storage limit exceeded: contract storage is full",
  },
  [PaymentErrorCode.ContractMigrationRequired]: {
    code: PaymentErrorCode.ContractMigrationRequired,
    name: "ContractMigrationRequired",
    message: "Contract migration required: upgrade to continue",
  },
  [PaymentErrorCode.InvalidEventType]: {
    code: PaymentErrorCode.InvalidEventType,
    name: "InvalidEventType",
    message: "Invalid event type for notification hook",
  },
  [PaymentErrorCode.WebhookUrlTooLong]: {
    code: PaymentErrorCode.WebhookUrlTooLong,
    name: "WebhookUrlTooLong",
    message: "Webhook URL too long: exceeds maximum length",
  },
  [PaymentErrorCode.MaxHooksExceeded]: {
    code: PaymentErrorCode.MaxHooksExceeded,
    name: "MaxHooksExceeded",
    message: "Maximum notification hooks exceeded",
  },
  [PaymentErrorCode.HookNotActive]: {
    code: PaymentErrorCode.HookNotActive,
    name: "HookNotActive",
    message: "Notification hook is not active",
  },
  [PaymentErrorCode.CrossContractCallFailed]: {
    code: PaymentErrorCode.CrossContractCallFailed,
    name: "CrossContractCallFailed",
    message: "Cross-contract call failed",
  },
  [PaymentErrorCode.InvalidScValEncoding]: {
    code: PaymentErrorCode.InvalidScValEncoding,
    name: "InvalidScValEncoding",
    message: "Invalid ScVal encoding in parameters",
  },
  [PaymentErrorCode.UnsupportedOperation]: {
    code: PaymentErrorCode.UnsupportedOperation,
    name: "UnsupportedOperation",
    message: "Unsupported operation: not available in this version",
  },
  [PaymentErrorCode.ContractNotLinked]: {
    code: PaymentErrorCode.ContractNotLinked,
    name: "ContractNotLinked",
    message: "Contract not linked: configure linked contract first",
  },
  [PaymentErrorCode.MaxSignersExceeded]: {
    code: PaymentErrorCode.MaxSignersExceeded,
    name: "MaxSignersExceeded",
    message: "Maximum signers exceeded for multisig",
  },
  [PaymentErrorCode.ZeroAddressNotAllowed]: {
    code: PaymentErrorCode.ZeroAddressNotAllowed,
    name: "ZeroAddressNotAllowed",
    message: "Zero address not allowed for this operation",
  },
  [PaymentErrorCode.InvalidNetwork]: {
    code: PaymentErrorCode.InvalidNetwork,
    name: "InvalidNetwork",
    message: "Invalid network: wrong Stellar network configured",
  },
  [PaymentErrorCode.StakingNotConfigured]: {
    code: PaymentErrorCode.StakingNotConfigured,
    name: "StakingNotConfigured",
    message: "Staking not configured: call configure_staking() first",
  },
  [PaymentErrorCode.StakingAlreadyActive]: {
    code: PaymentErrorCode.StakingAlreadyActive,
    name: "StakingAlreadyActive",
    message: "Staking already active: cannot modify while staking",
  },
  [PaymentErrorCode.RewardsPoolEmpty]: {
    code: PaymentErrorCode.RewardsPoolEmpty,
    name: "RewardsPoolEmpty",
    message: "Rewards pool empty: no rewards available for distribution",
  },
  [PaymentErrorCode.UnstakingPeriodActive]: {
    code: PaymentErrorCode.UnstakingPeriodActive,
    name: "UnstakingPeriodActive",
    message: "Unstaking period active: funds are still in cooldown",
  },
  [PaymentErrorCode.MinimumStakeNotMet]: {
    code: PaymentErrorCode.MinimumStakeNotMet,
    name: "MinimumStakeNotMet",
    message: "Minimum stake not met: stake must exceed the minimum",
  },
  [PaymentErrorCode.MaximumStakeExceeded]: {
    code: PaymentErrorCode.MaximumStakeExceeded,
    name: "MaximumStakeExceeded",
    message: "Maximum stake exceeded: stake cannot exceed the cap",
  },
  [PaymentErrorCode.RewardsAlreadyClaimed]: {
    code: PaymentErrorCode.RewardsAlreadyClaimed,
    name: "RewardsAlreadyClaimed",
    message: "Rewards already claimed for this epoch",
  },
  [PaymentErrorCode.DelegationNotAllowed]: {
    code: PaymentErrorCode.DelegationNotAllowed,
    name: "DelegationNotAllowed",
    message: "Delegation not allowed: delegator is not authorized",
  },
  [PaymentErrorCode.ValidatorNotActive]: {
    code: PaymentErrorCode.ValidatorNotActive,
    name: "ValidatorNotActive",
    message: "Validator not active: selected validator is offline",
  },
  [PaymentErrorCode.SlashingConditionMet]: {
    code: PaymentErrorCode.SlashingConditionMet,
    name: "SlashingConditionMet",
    message: "Slashing condition met: stake is subject to penalty",
  },
  [PaymentErrorCode.StakingPaused]: {
    code: PaymentErrorCode.StakingPaused,
    name: "StakingPaused",
    message: "Staking is currently paused",
  },
  [PaymentErrorCode.CompoundRewardsFailed]: {
    code: PaymentErrorCode.CompoundRewardsFailed,
    name: "CompoundRewardsFailed",
    message: "Compound rewards failed: auto-compound error",
  },
  [PaymentErrorCode.YieldTooLow]: {
    code: PaymentErrorCode.YieldTooLow,
    name: "YieldTooLow",
    message: "Yield too low: below minimum acceptable rate",
  },
  [PaymentErrorCode.StakingPeriodNotEnded]: {
    code: PaymentErrorCode.StakingPeriodNotEnded,
    name: "StakingPeriodNotEnded",
    message: "Staking period not ended: cannot unstake yet",
  },
  [PaymentErrorCode.RewardDistributionFailed]: {
    code: PaymentErrorCode.RewardDistributionFailed,
    name: "RewardDistributionFailed",
    message: "Reward distribution failed: transfer error",
  },
  [PaymentErrorCode.UnauthorizedDelegator]: {
    code: PaymentErrorCode.UnauthorizedDelegator,
    name: "UnauthorizedDelegator",
    message: "Delegator not authorized for this validator",
  },
  [PaymentErrorCode.BridgeNotConfigured]: {
    code: PaymentErrorCode.BridgeNotConfigured,
    name: "BridgeNotConfigured",
    message: "Bridge not configured: call configure_bridge() first",
  },
  [PaymentErrorCode.BridgePaused]: {
    code: PaymentErrorCode.BridgePaused,
    name: "BridgePaused",
    message: "Bridge is currently paused",
  },
  [PaymentErrorCode.InvalidSourceChain]: {
    code: PaymentErrorCode.InvalidSourceChain,
    name: "InvalidSourceChain",
    message: "Invalid source chain identifier",
  },
  [PaymentErrorCode.InvalidDestinationChain]: {
    code: PaymentErrorCode.InvalidDestinationChain,
    name: "InvalidDestinationChain",
    message: "Invalid destination chain identifier",
  },
  [PaymentErrorCode.CrossChainProofInvalid]: {
    code: PaymentErrorCode.CrossChainProofInvalid,
    name: "CrossChainProofInvalid",
    message: "Cross-chain proof invalid: verification failed",
  },
  [PaymentErrorCode.BridgeRelayerNotSet]: {
    code: PaymentErrorCode.BridgeRelayerNotSet,
    name: "BridgeRelayerNotSet",
    message: "Bridge relayer not set: configure relayer address",
  },
  [PaymentErrorCode.BridgeAmountTooLow]: {
    code: PaymentErrorCode.BridgeAmountTooLow,
    name: "BridgeAmountTooLow",
    message: "Bridge amount too low: below minimum transfer",
  },
  [PaymentErrorCode.BridgeAmountTooHigh]: {
    code: PaymentErrorCode.BridgeAmountTooHigh,
    name: "BridgeAmountTooHigh",
    message: "Bridge amount too high: exceeds maximum transfer",
  },
  [PaymentErrorCode.BridgeTransactionExpired]: {
    code: PaymentErrorCode.BridgeTransactionExpired,
    name: "BridgeTransactionExpired",
    message: "Bridge transaction expired: timeout reached",
  },
  [PaymentErrorCode.UnsupportedTokenPair]: {
    code: PaymentErrorCode.UnsupportedTokenPair,
    name: "UnsupportedTokenPair",
    message: "Unsupported token pair for bridge transfer",
  },
  [PaymentErrorCode.InsuranceFundNotConfigured]: {
    code: PaymentErrorCode.InsuranceFundNotConfigured,
    name: "InsuranceFundNotConfigured",
    message: "Insurance fund not configured",
  },
  [PaymentErrorCode.InsuranceFundEmpty]: {
    code: PaymentErrorCode.InsuranceFundEmpty,
    name: "InsuranceFundEmpty",
    message: "Insurance fund empty: no funds available for claims",
  },
  [PaymentErrorCode.InsuranceClaimAlreadyFiled]: {
    code: PaymentErrorCode.InsuranceClaimAlreadyFiled,
    name: "InsuranceClaimAlreadyFiled",
    message: "Insurance claim already filed for this event",
  },
  [PaymentErrorCode.InsuranceClaimRejected]: {
    code: PaymentErrorCode.InsuranceClaimRejected,
    name: "InsuranceClaimRejected",
    message: "Insurance claim rejected: does not meet criteria",
  },
  [PaymentErrorCode.InsuranceClaimWindowExpired]: {
    code: PaymentErrorCode.InsuranceClaimWindowExpired,
    name: "InsuranceClaimWindowExpired",
    message: "Insurance claim window expired",
  },
  [PaymentErrorCode.CoverageLimitExceeded]: {
    code: PaymentErrorCode.CoverageLimitExceeded,
    name: "CoverageLimitExceeded",
    message: "Coverage limit exceeded: claim exceeds policy cap",
  },
  [PaymentErrorCode.PremiumNotPaid]: {
    code: PaymentErrorCode.PremiumNotPaid,
    name: "PremiumNotPaid",
    message: "Premium not paid: insurance coverage is inactive",
  },
  [PaymentErrorCode.RiskScoreTooHigh]: {
    code: PaymentErrorCode.RiskScoreTooHigh,
    name: "RiskScoreTooHigh",
    message: "Risk score too high: coverage denied",
  },
  [PaymentErrorCode.UnderwritingFailed]: {
    code: PaymentErrorCode.UnderwritingFailed,
    name: "UnderwritingFailed",
    message: "Underwriting failed: risk assessment error",
  },
  [PaymentErrorCode.InsurancePaused]: {
    code: PaymentErrorCode.InsurancePaused,
    name: "InsurancePaused",
    message: "Insurance operations are currently paused",
  },
  [PaymentErrorCode.KYCNotCompleted]: {
    code: PaymentErrorCode.KYCNotCompleted,
    name: "KYCNotCompleted",
    message: "KYC not completed: identity verification required",
  },
  [PaymentErrorCode.KYCTierTooLow]: {
    code: PaymentErrorCode.KYCTierTooLow,
    name: "KYCTierTooLow",
    message: "KYC tier too low: upgrade verification level",
  },
  [PaymentErrorCode.AMLFlagRaised]: {
    code: PaymentErrorCode.AMLFlagRaised,
    name: "AMLFlagRaised",
    message: "AML flag raised: transaction blocked for review",
  },
  [PaymentErrorCode.SanctionsListMatch]: {
    code: PaymentErrorCode.SanctionsListMatch,
    name: "SanctionsListMatch",
    message: "Sanctions list match: address is restricted",
  },
  [PaymentErrorCode.IdentityVerificationFailed]: {
    code: PaymentErrorCode.IdentityVerificationFailed,
    name: "IdentityVerificationFailed",
    message: "Identity verification failed: documents invalid",
  },
  [PaymentErrorCode.TravelRuleViolation]: {
    code: PaymentErrorCode.TravelRuleViolation,
    name: "TravelRuleViolation",
    message: "Travel rule violation: beneficiary info required",
  },
  [PaymentErrorCode.JurisdictionNotSupported]: {
    code: PaymentErrorCode.JurisdictionNotSupported,
    name: "JurisdictionNotSupported",
    message: "Jurisdiction not supported for this operation",
  },
  [PaymentErrorCode.ResidencyCheckFailed]: {
    code: PaymentErrorCode.ResidencyCheckFailed,
    name: "ResidencyCheckFailed",
    message: "Residency check failed: proof of residency required",
  },
  [PaymentErrorCode.AccreditationRequired]: {
    code: PaymentErrorCode.AccreditationRequired,
    name: "AccreditationRequired",
    message: "Accreditation required: investor status not verified",
  },
  [PaymentErrorCode.AgeVerificationFailed]: {
    code: PaymentErrorCode.AgeVerificationFailed,
    name: "AgeVerificationFailed",
    message: "Age verification failed: minimum age not met",
  },
  [PaymentErrorCode.PaymentRouteNotFound]: {
    code: PaymentErrorCode.PaymentRouteNotFound,
    name: "PaymentRouteNotFound",
    message: "Payment route not found: no valid path",
  },
  [PaymentErrorCode.PaymentSplitFailed]: {
    code: PaymentErrorCode.PaymentSplitFailed,
    name: "PaymentSplitFailed",
    message: "Payment split failed: distribution error",
  },
  [PaymentErrorCode.SplitPercentageInvalid]: {
    code: PaymentErrorCode.SplitPercentageInvalid,
    name: "SplitPercentageInvalid",
    message: "Split percentage invalid: must sum to 100%",
  },
  [PaymentErrorCode.RouteHopLimitExceeded]: {
    code: PaymentErrorCode.RouteHopLimitExceeded,
    name: "RouteHopLimitExceeded",
    message: "Route hop limit exceeded: path too long",
  },
  [PaymentErrorCode.PathPaymentTooExpensive]: {
    code: PaymentErrorCode.PathPaymentTooExpensive,
    name: "PathPaymentTooExpensive",
    message: "Path payment too expensive: exceeds max fee",
  },
  [PaymentErrorCode.LiquidityPoolNotFound]: {
    code: PaymentErrorCode.LiquidityPoolNotFound,
    name: "LiquidityPoolNotFound",
    message: "Liquidity pool not found for asset pair",
  },
  [PaymentErrorCode.SlippageExceeded]: {
    code: PaymentErrorCode.SlippageExceeded,
    name: "SlippageExceeded",
    message: "Slippage exceeded: price moved beyond tolerance",
  },
  [PaymentErrorCode.DeadlineExceeded]: {
    code: PaymentErrorCode.DeadlineExceeded,
    name: "DeadlineExceeded",
    message: "Deadline exceeded: transaction too old",
  },
  [PaymentErrorCode.PriceOracleStale]: {
    code: PaymentErrorCode.PriceOracleStale,
    name: "PriceOracleStale",
    message: "Price oracle stale: last update too old",
  },
  [PaymentErrorCode.FlashLoanNotRepaid]: {
    code: PaymentErrorCode.FlashLoanNotRepaid,
    name: "FlashLoanNotRepaid",
    message: "Flash loan not repaid in same transaction",
  },
  [PaymentErrorCode.OutOfGas]: {
    code: PaymentErrorCode.OutOfGas,
    name: "OutOfGas",
    message: "Out of gas: computation budget exhausted",
  },
  [PaymentErrorCode.GasPriceTooLow]: {
    code: PaymentErrorCode.GasPriceTooLow,
    name: "GasPriceTooLow",
    message: "Gas price too low: below network minimum",
  },
  [PaymentErrorCode.GasRefundFailed]: {
    code: PaymentErrorCode.GasRefundFailed,
    name: "GasRefundFailed",
    message: "Gas refund failed: refund transfer error",
  },
  [PaymentErrorCode.MemoryLimitExceeded]: {
    code: PaymentErrorCode.MemoryLimitExceeded,
    name: "MemoryLimitExceeded",
    message: "Memory limit exceeded: allocation too large",
  },
  [PaymentErrorCode.StackDepthExceeded]: {
    code: PaymentErrorCode.StackDepthExceeded,
    name: "StackDepthExceeded",
    message: "Stack depth exceeded: too many nested calls",
  },
  [PaymentErrorCode.InstructionBudgetExceeded]: {
    code: PaymentErrorCode.InstructionBudgetExceeded,
    name: "InstructionBudgetExceeded",
    message: "Instruction budget exceeded: too many operations",
  },
  [PaymentErrorCode.ReadBudgetExceeded]: {
    code: PaymentErrorCode.ReadBudgetExceeded,
    name: "ReadBudgetExceeded",
    message: "Read budget exceeded: too many storage reads",
  },
  [PaymentErrorCode.WriteBudgetExceeded]: {
    code: PaymentErrorCode.WriteBudgetExceeded,
    name: "WriteBudgetExceeded",
    message: "Write budget exceeded: too many storage writes",
  },
  [PaymentErrorCode.TTLTooLow]: {
    code: PaymentErrorCode.TTLTooLow,
    name: "TTLTooLow",
    message: "TTL too low: entry would expire too soon",
  },
  [PaymentErrorCode.LedgerEntryLimitReached]: {
    code: PaymentErrorCode.LedgerEntryLimitReached,
    name: "LedgerEntryLimitReached",
    message: "Ledger entry limit reached: cannot create more",
  },
  [PaymentErrorCode.OracleNotConfigured]: {
    code: PaymentErrorCode.OracleNotConfigured,
    name: "OracleNotConfigured",
    message: "Oracle not configured: call set_oracle() first",
  },
  [PaymentErrorCode.OracleTimeout]: {
    code: PaymentErrorCode.OracleTimeout,
    name: "OracleTimeout",
    message: "Oracle timeout: response took too long",
  },
  [PaymentErrorCode.OraclePriceDeviation]: {
    code: PaymentErrorCode.OraclePriceDeviation,
    name: "OraclePriceDeviation",
    message: "Oracle price deviation: outlier detected",
  },
  [PaymentErrorCode.DataFeedUnavailable]: {
    code: PaymentErrorCode.DataFeedUnavailable,
    name: "DataFeedUnavailable",
    message: "Data feed unavailable: source is offline",
  },
  [PaymentErrorCode.DataFeedTampered]: {
    code: PaymentErrorCode.DataFeedTampered,
    name: "DataFeedTampered",
    message: "Data feed tampered: integrity check failed",
  },
  [PaymentErrorCode.OracleAlreadyActive]: {
    code: PaymentErrorCode.OracleAlreadyActive,
    name: "OracleAlreadyActive",
    message: "Oracle already active: duplicate registration",
  },
  [PaymentErrorCode.PriceFeedStale]: {
    code: PaymentErrorCode.PriceFeedStale,
    name: "PriceFeedStale",
    message: "Price feed stale: last update exceeds threshold",
  },
  [PaymentErrorCode.ConfidenceIntervalTooWide]: {
    code: PaymentErrorCode.ConfidenceIntervalTooWide,
    name: "ConfidenceIntervalTooWide",
    message: "Confidence interval too wide: price uncertain",
  },
  [PaymentErrorCode.OracleSignatureInvalid]: {
    code: PaymentErrorCode.OracleSignatureInvalid,
    name: "OracleSignatureInvalid",
    message: "Oracle signature invalid: attestation failed",
  },
  [PaymentErrorCode.MaxPriceAgeExceeded]: {
    code: PaymentErrorCode.MaxPriceAgeExceeded,
    name: "MaxPriceAgeExceeded",
    message: "Maximum price age exceeded: feed too old",
  },
  [PaymentErrorCode.BatchExecutionTimeout]: {
    code: PaymentErrorCode.BatchExecutionTimeout,
    name: "BatchExecutionTimeout",
    message: "Batch execution timeout: not all items finished",
  },
  [PaymentErrorCode.BatchPartialFailure]: {
    code: PaymentErrorCode.BatchPartialFailure,
    name: "BatchPartialFailure",
    message: "Batch partial failure: some items failed",
  },
  [PaymentErrorCode.StreamRateInvalid]: {
    code: PaymentErrorCode.StreamRateInvalid,
    name: "StreamRateInvalid",
    message: "Stream rate invalid: must be positive non-zero",
  },
  [PaymentErrorCode.StreamTooLong]: {
    code: PaymentErrorCode.StreamTooLong,
    name: "StreamTooLong",
    message: "Stream duration too long: exceeds maximum",
  },
  [PaymentErrorCode.StreamClaimTooEarly]: {
    code: PaymentErrorCode.StreamClaimTooEarly,
    name: "StreamClaimTooEarly",
    message: "Stream claim too early: minimum interval not met",
  },
  [PaymentErrorCode.BatchAuthorizationFailed]: {
    code: PaymentErrorCode.BatchAuthorizationFailed,
    name: "BatchAuthorizationFailed",
    message: "Batch authorization failed: signer rejected",
  },
  [PaymentErrorCode.BatchDuplicateId]: {
    code: PaymentErrorCode.BatchDuplicateId,
    name: "BatchDuplicateId",
    message: "Batch duplicate ID: transaction already processed",
  },
  [PaymentErrorCode.StreamBeneficiaryUnchanged]: {
    code: PaymentErrorCode.StreamBeneficiaryUnchanged,
    name: "StreamBeneficiaryUnchanged",
    message: "Stream beneficiary unchanged: same as current",
  },
  [PaymentErrorCode.StreamTransferNotAllowed]: {
    code: PaymentErrorCode.StreamTransferNotAllowed,
    name: "StreamTransferNotAllowed",
    message: "Stream transfer not allowed: stream is non-transferable",
  },
  [PaymentErrorCode.BatchCleanupFailed]: {
    code: PaymentErrorCode.BatchCleanupFailed,
    name: "BatchCleanupFailed",
    message: "Batch cleanup failed: stale state removal error",
  },
  [PaymentErrorCode.DisputeNotOpen]: {
    code: PaymentErrorCode.DisputeNotOpen,
    name: "DisputeNotOpen",
    message: "Dispute not open: no active dispute found",
  },
  [PaymentErrorCode.DisputeArbiterNotSet]: {
    code: PaymentErrorCode.DisputeArbiterNotSet,
    name: "DisputeArbiterNotSet",
    message: "Dispute arbiter not set: configure arbiter first",
  },
  [PaymentErrorCode.DisputeEvidenceRequired]: {
    code: PaymentErrorCode.DisputeEvidenceRequired,
    name: "DisputeEvidenceRequired",
    message: "Dispute evidence required: must submit proof",
  },
  [PaymentErrorCode.DisputeAlreadyResolved]: {
    code: PaymentErrorCode.DisputeAlreadyResolved,
    name: "DisputeAlreadyResolved",
    message: "Dispute already resolved: final decision made",
  },
  [PaymentErrorCode.DisputeResolutionTimedOut]: {
    code: PaymentErrorCode.DisputeResolutionTimedOut,
    name: "DisputeResolutionTimedOut",
    message: "Dispute resolution timed out: arbiter did not respond",
  },
  [PaymentErrorCode.ArbiterNotAuthorized]: {
    code: PaymentErrorCode.ArbiterNotAuthorized,
    name: "ArbiterNotAuthorized",
    message: "Arbiter not authorized: not in approved list",
  },
  [PaymentErrorCode.MediationFailed]: {
    code: PaymentErrorCode.MediationFailed,
    name: "MediationFailed",
    message: "Mediation failed: parties could not agree",
  },
  [PaymentErrorCode.AppealWindowClosed]: {
    code: PaymentErrorCode.AppealWindowClosed,
    name: "AppealWindowClosed",
    message: "Appeal window closed: too late to appeal",
  },
  [PaymentErrorCode.DisputeBondInsufficient]: {
    code: PaymentErrorCode.DisputeBondInsufficient,
    name: "DisputeBondInsufficient",
    message: "Dispute bond insufficient: must stake more",
  },
  [PaymentErrorCode.DisputeEscalationFailed]: {
    code: PaymentErrorCode.DisputeEscalationFailed,
    name: "DisputeEscalationFailed",
    message: "Dispute escalation failed: higher authority error",
  },
  [PaymentErrorCode.MaxStorageEntriesReached]: {
    code: PaymentErrorCode.MaxStorageEntriesReached,
    name: "MaxStorageEntriesReached",
    message: "Maximum storage entries reached: ledger full",
  },
  [PaymentErrorCode.StorageFeeNotPaid]: {
    code: PaymentErrorCode.StorageFeeNotPaid,
    name: "StorageFeeNotPaid",
    message: "Storage fee not paid: rent payment required",
  },
  [PaymentErrorCode.ArchiveEntryNotFound]: {
    code: PaymentErrorCode.ArchiveEntryNotFound,
    name: "ArchiveEntryNotFound",
    message: "Archive entry not found: record already pruned",
  },
  [PaymentErrorCode.StateSyncMismatch]: {
    code: PaymentErrorCode.StateSyncMismatch,
    name: "StateSyncMismatch",
    message: "State sync mismatch: ledger state inconsistent",
  },
  [PaymentErrorCode.MigrationInProgress]: {
    code: PaymentErrorCode.MigrationInProgress,
    name: "MigrationInProgress",
    message: "Migration in progress: try again later",
  },
  [PaymentErrorCode.RollbackDetected]: {
    code: PaymentErrorCode.RollbackDetected,
    name: "RollbackDetected",
    message: "Rollback detected: chain reorganization",
  },
  [PaymentErrorCode.SnapshotVerificationFailed]: {
    code: PaymentErrorCode.SnapshotVerificationFailed,
    name: "SnapshotVerificationFailed",
    message: "Snapshot verification failed: hash mismatch",
  },
  [PaymentErrorCode.ContractDeprecated]: {
    code: PaymentErrorCode.ContractDeprecated,
    name: "ContractDeprecated",
    message: "Contract deprecated: use the new version",
  },
  [PaymentErrorCode.EmergencyShutdownActive]: {
    code: PaymentErrorCode.EmergencyShutdownActive,
    name: "EmergencyShutdownActive",
    message: "Emergency shutdown active: all operations blocked",
  },
  [PaymentErrorCode.SystemOverloaded]: {
    code: PaymentErrorCode.SystemOverloaded,
    name: "SystemOverloaded",
    message: "System overloaded: too many concurrent requests",
  },
  [PaymentErrorCode.DelegateNotActive]: {
    code: PaymentErrorCode.DelegateNotActive,
    name: "DelegateNotActive",
    message: "Delegate not active: delegator is offline or disabled",
  },
  [PaymentErrorCode.DelegationExpired]: {
    code: PaymentErrorCode.DelegationExpired,
    name: "DelegationExpired",
    message: "Delegation expired: delegation period has ended",
  },
  [PaymentErrorCode.VoteDelegationMismatch]: {
    code: PaymentErrorCode.VoteDelegationMismatch,
    name: "VoteDelegationMismatch",
    message: "Vote delegation mismatch: delegate does not match voter",
  },
  [PaymentErrorCode.ProposalCancelled]: {
    code: PaymentErrorCode.ProposalCancelled,
    name: "ProposalCancelled",
    message: "Proposal cancelled: proposal was withdrawn by creator",
  },
  [PaymentErrorCode.ProposalQuorumChanged]: {
    code: PaymentErrorCode.ProposalQuorumChanged,
    name: "ProposalQuorumChanged",
    message: "Proposal quorum changed: quorum was modified mid-vote",
  },
  [PaymentErrorCode.EmergencyGovernancePaused]: {
    code: PaymentErrorCode.EmergencyGovernancePaused,
    name: "EmergencyGovernancePaused",
    message: "Emergency governance paused: voting is temporarily suspended",
  },
  [PaymentErrorCode.GovernanceTokenLocked]: {
    code: PaymentErrorCode.GovernanceTokenLocked,
    name: "GovernanceTokenLocked",
    message: "Governance token locked: tokens are in a lockup period",
  },
  [PaymentErrorCode.VotingPowerFrozen]: {
    code: PaymentErrorCode.VotingPowerFrozen,
    name: "VotingPowerFrozen",
    message: "Voting power frozen: votes are immobilized by a freeze",
  },
  [PaymentErrorCode.ProposalExecutionFailed]: {
    code: PaymentErrorCode.ProposalExecutionFailed,
    name: "ProposalExecutionFailed",
    message: "Proposal execution failed: on-chain execution reverted",
  },
  [PaymentErrorCode.GovernanceUpgradePending]: {
    code: PaymentErrorCode.GovernanceUpgradePending,
    name: "GovernanceUpgradePending",
    message: "Governance upgrade pending: upgrade has not been finalized",
  },
  [PaymentErrorCode.TreasuryNotConfigured]: {
    code: PaymentErrorCode.TreasuryNotConfigured,
    name: "TreasuryNotConfigured",
    message: "Treasury not configured: call configure_treasury() first",
  },
  [PaymentErrorCode.TreasuryWithdrawalPending]: {
    code: PaymentErrorCode.TreasuryWithdrawalPending,
    name: "TreasuryWithdrawalPending",
    message: "Treasury withdrawal pending: timelock has not elapsed",
  },
  [PaymentErrorCode.ReserveRequirementNotMet]: {
    code: PaymentErrorCode.ReserveRequirementNotMet,
    name: "ReserveRequirementNotMet",
    message: "Reserve requirement not met: minimum reserve ratio breached",
  },
  [PaymentErrorCode.TreasuryMultisigRequired]: {
    code: PaymentErrorCode.TreasuryMultisigRequired,
    name: "TreasuryMultisigRequired",
    message: "Treasury multisig required: threshold signatures missing",
  },
  [PaymentErrorCode.ReserveAssetUnavailable]: {
    code: PaymentErrorCode.ReserveAssetUnavailable,
    name: "ReserveAssetUnavailable",
    message: "Reserve asset unavailable: asset cannot be used as reserve",
  },
  [PaymentErrorCode.TreasuryReportMismatch]: {
    code: PaymentErrorCode.TreasuryReportMismatch,
    name: "TreasuryReportMismatch",
    message: "Treasury report mismatch: balance does not match ledger",
  },
  [PaymentErrorCode.ReserveRatioBreached]: {
    code: PaymentErrorCode.ReserveRatioBreached,
    name: "ReserveRatioBreached",
    message: "Reserve ratio breached: reserves fell below the minimum",
  },
  [PaymentErrorCode.TreasuryAuditFailed]: {
    code: PaymentErrorCode.TreasuryAuditFailed,
    name: "TreasuryAuditFailed",
    message: "Treasury audit failed: reconciliation check did not pass",
  },
  [PaymentErrorCode.ReserveRebalanceFailed]: {
    code: PaymentErrorCode.ReserveRebalanceFailed,
    name: "ReserveRebalanceFailed",
    message: "Reserve rebalance failed: allocation update reverted",
  },
  [PaymentErrorCode.TreasuryAccessRevoked]: {
    code: PaymentErrorCode.TreasuryAccessRevoked,
    name: "TreasuryAccessRevoked",
    message: "Treasury access revoked: caller permissions were removed",
  },
  [PaymentErrorCode.TokenAlreadyListed]: {
    code: PaymentErrorCode.TokenAlreadyListed,
    name: "TokenAlreadyListed",
    message: "Token already listed: asset is already supported",
  },
  [PaymentErrorCode.TokenDelistingPending]: {
    code: PaymentErrorCode.TokenDelistingPending,
    name: "TokenDelistingPending",
    message: "Token delisting pending: removal is awaiting timelock",
  },
  [PaymentErrorCode.AssetPairNotFound]: {
    code: PaymentErrorCode.AssetPairNotFound,
    name: "AssetPairNotFound",
    message: "Asset pair not found: no market exists for the pair",
  },
  [PaymentErrorCode.TokenSupplyCapExceeded]: {
    code: PaymentErrorCode.TokenSupplyCapExceeded,
    name: "TokenSupplyCapExceeded",
    message: "Token supply cap exceeded: mint would exceed the cap",
  },
  [PaymentErrorCode.MintingPaused]: {
    code: PaymentErrorCode.MintingPaused,
    name: "MintingPaused",
    message: "Minting paused: new issuance is temporarily disabled",
  },
  [PaymentErrorCode.BurningPaused]: {
    code: PaymentErrorCode.BurningPaused,
    name: "BurningPaused",
    message: "Burning paused: token destruction is temporarily disabled",
  },
  [PaymentErrorCode.TokenFrozen]: {
    code: PaymentErrorCode.TokenFrozen,
    name: "TokenFrozen",
    message: "Token frozen: asset transfers are blocked",
  },
  [PaymentErrorCode.AssetTrustlineMissing]: {
    code: PaymentErrorCode.AssetTrustlineMissing,
    name: "AssetTrustlineMissing",
    message: "Asset trustline missing: trustline must be established",
  },
  [PaymentErrorCode.TokenMetadataInvalid]: {
    code: PaymentErrorCode.TokenMetadataInvalid,
    name: "TokenMetadataInvalid",
    message: "Token metadata invalid: name, symbol, or decimals malformed",
  },
  [PaymentErrorCode.AssetMigrationPending]: {
    code: PaymentErrorCode.AssetMigrationPending,
    name: "AssetMigrationPending",
    message: "Asset migration pending: upgrade to new contract incomplete",
  },
  [PaymentErrorCode.LendingPoolNotConfigured]: {
    code: PaymentErrorCode.LendingPoolNotConfigured,
    name: "LendingPoolNotConfigured",
    message: "Lending pool not configured: call configure_lending() first",
  },
  [PaymentErrorCode.LoanNotFound]: {
    code: PaymentErrorCode.LoanNotFound,
    name: "LoanNotFound",
    message: "Loan not found",
  },
  [PaymentErrorCode.LoanAlreadyRepaid]: {
    code: PaymentErrorCode.LoanAlreadyRepaid,
    name: "LoanAlreadyRepaid",
    message: "Loan already repaid: no outstanding balance",
  },
  [PaymentErrorCode.CollateralInsufficient]: {
    code: PaymentErrorCode.CollateralInsufficient,
    name: "CollateralInsufficient",
    message: "Collateral insufficient: below required ratio",
  },
  [PaymentErrorCode.LiquidationPending]: {
    code: PaymentErrorCode.LiquidationPending,
    name: "LiquidationPending",
    message: "Liquidation pending: position is in the process of liquidation",
  },
  [PaymentErrorCode.InterestRateInvalid]: {
    code: PaymentErrorCode.InterestRateInvalid,
    name: "InterestRateInvalid",
    message: "Interest rate invalid: outside allowed bounds",
  },
  [PaymentErrorCode.CreditLimitExceeded]: {
    code: PaymentErrorCode.CreditLimitExceeded,
    name: "CreditLimitExceeded",
    message: "Credit limit exceeded: borrow would exceed the limit",
  },
  [PaymentErrorCode.LoanMaturityReached]: {
    code: PaymentErrorCode.LoanMaturityReached,
    name: "LoanMaturityReached",
    message: "Loan maturity reached: repayment is now due",
  },
  [PaymentErrorCode.CollateralFrozen]: {
    code: PaymentErrorCode.CollateralFrozen,
    name: "CollateralFrozen",
    message: "Collateral frozen: collateral cannot be moved",
  },
  [PaymentErrorCode.LendingPaused]: {
    code: PaymentErrorCode.LendingPaused,
    name: "LendingPaused",
    message: "Lending paused: borrow and lend operations are suspended",
  },
  [PaymentErrorCode.SubscriptionNotFound]: {
    code: PaymentErrorCode.SubscriptionNotFound,
    name: "SubscriptionNotFound",
    message: "Subscription not found",
  },
  [PaymentErrorCode.SubscriptionAlreadyCancelled]: {
    code: PaymentErrorCode.SubscriptionAlreadyCancelled,
    name: "SubscriptionAlreadyCancelled",
    message: "Subscription already cancelled",
  },
  [PaymentErrorCode.SubscriptionRenewalFailed]: {
    code: PaymentErrorCode.SubscriptionRenewalFailed,
    name: "SubscriptionRenewalFailed",
    message: "Subscription renewal failed: payment did not settle",
  },
  [PaymentErrorCode.BillingCycleInvalid]: {
    code: PaymentErrorCode.BillingCycleInvalid,
    name: "BillingCycleInvalid",
    message: "Billing cycle invalid: interval is not supported",
  },
  [PaymentErrorCode.SubscriptionPaused]: {
    code: PaymentErrorCode.SubscriptionPaused,
    name: "SubscriptionPaused",
    message: "Subscription paused: renewals are temporarily halted",
  },
  [PaymentErrorCode.TrialPeriodExpired]: {
    code: PaymentErrorCode.TrialPeriodExpired,
    name: "TrialPeriodExpired",
    message: "Trial period expired: paid plan is now required",
  },
  [PaymentErrorCode.PaymentMethodInvalid]: {
    code: PaymentErrorCode.PaymentMethodInvalid,
    name: "PaymentMethodInvalid",
    message: "Payment method invalid: token or method not accepted",
  },
  [PaymentErrorCode.SubscriptionTierNotAllowed]: {
    code: PaymentErrorCode.SubscriptionTierNotAllowed,
    name: "SubscriptionTierNotAllowed",
    message: "Subscription tier not allowed: upgrade is restricted",
  },
  [PaymentErrorCode.UsageQuotaExceeded]: {
    code: PaymentErrorCode.UsageQuotaExceeded,
    name: "UsageQuotaExceeded",
    message: "Usage quota exceeded: plan allowance has been reached",
  },
  [PaymentErrorCode.SubscriptionUpgradePending]: {
    code: PaymentErrorCode.SubscriptionUpgradePending,
    name: "SubscriptionUpgradePending",
    message: "Subscription upgrade pending: change has not been applied",
  },
  [PaymentErrorCode.ZkProofInvalid]: {
    code: PaymentErrorCode.ZkProofInvalid,
    name: "ZkProofInvalid",
    message: "Zero-knowledge proof invalid: verification failed",
  },
  [PaymentErrorCode.PrivacyPoolNotConfigured]: {
    code: PaymentErrorCode.PrivacyPoolNotConfigured,
    name: "PrivacyPoolNotConfigured",
    message: "Privacy pool not configured: call configure_privacy() first",
  },
  [PaymentErrorCode.CommitmentAlreadySpent]: {
    code: PaymentErrorCode.CommitmentAlreadySpent,
    name: "CommitmentAlreadySpent",
    message: "Commitment already spent: double-spend detected",
  },
  [PaymentErrorCode.NullifierAlreadyUsed]: {
    code: PaymentErrorCode.NullifierAlreadyUsed,
    name: "NullifierAlreadyUsed",
    message: "Nullifier already used: proof was previously consumed",
  },
  [PaymentErrorCode.MerklePathInvalid]: {
    code: PaymentErrorCode.MerklePathInvalid,
    name: "MerklePathInvalid",
    message: "Merkle path invalid: membership proof is malformed",
  },
  [PaymentErrorCode.PrivacyDepositTooLow]: {
    code: PaymentErrorCode.PrivacyDepositTooLow,
    name: "PrivacyDepositTooLow",
    message: "Privacy deposit too low: below the minimum amount",
  },
  [PaymentErrorCode.PrivacyWithdrawalPending]: {
    code: PaymentErrorCode.PrivacyWithdrawalPending,
    name: "PrivacyWithdrawalPending",
    message: "Privacy withdrawal pending: timelock has not elapsed",
  },
  [PaymentErrorCode.StealthAddressInvalid]: {
    code: PaymentErrorCode.StealthAddressInvalid,
    name: "StealthAddressInvalid",
    message: "Stealth address invalid: cannot derive recipient",
  },
  [PaymentErrorCode.ConfidentialTransferFailed]: {
    code: PaymentErrorCode.ConfidentialTransferFailed,
    name: "ConfidentialTransferFailed",
    message: "Confidential transfer failed: shielded amount mismatch",
  },
  [PaymentErrorCode.PrivacyPaused]: {
    code: PaymentErrorCode.PrivacyPaused,
    name: "PrivacyPaused",
    message: "Privacy paused: shielded operations are suspended",
  },
  [PaymentErrorCode.NotificationServiceDown]: {
    code: PaymentErrorCode.NotificationServiceDown,
    name: "NotificationServiceDown",
    message: "Notification service down: delivery backend unavailable",
  },
  [PaymentErrorCode.MessageTooLong]: {
    code: PaymentErrorCode.MessageTooLong,
    name: "MessageTooLong",
    message: "Message too long: exceeds maximum length",
  },
  [PaymentErrorCode.RecipientUnsubscribed]: {
    code: PaymentErrorCode.RecipientUnsubscribed,
    name: "RecipientUnsubscribed",
    message: "Recipient unsubscribed: target has opted out",
  },
  [PaymentErrorCode.NotificationDeliveryFailed]: {
    code: PaymentErrorCode.NotificationDeliveryFailed,
    name: "NotificationDeliveryFailed",
    message: "Notification delivery failed: could not reach recipient",
  },
  [PaymentErrorCode.NotificationRateLimited]: {
    code: PaymentErrorCode.NotificationRateLimited,
    name: "NotificationRateLimited",
    message: "Notification rate limited: too many messages sent",
  },
  [PaymentErrorCode.MessageSignatureInvalid]: {
    code: PaymentErrorCode.MessageSignatureInvalid,
    name: "MessageSignatureInvalid",
    message: "Message signature invalid: sender could not be verified",
  },
  [PaymentErrorCode.InboxFull]: {
    code: PaymentErrorCode.InboxFull,
    name: "InboxFull",
    message: "Inbox full: recipient storage limit reached",
  },
  [PaymentErrorCode.NotificationTemplateInvalid]: {
    code: PaymentErrorCode.NotificationTemplateInvalid,
    name: "NotificationTemplateInvalid",
    message: "Notification template invalid: malformed payload",
  },
  [PaymentErrorCode.MessageExpired]: {
    code: PaymentErrorCode.MessageExpired,
    name: "MessageExpired",
    message: "Message expired: delivery window has passed",
  },
  [PaymentErrorCode.NotificationChannelClosed]: {
    code: PaymentErrorCode.NotificationChannelClosed,
    name: "NotificationChannelClosed",
    message: "Notification channel closed: channel is no longer active",
  },
  [PaymentErrorCode.ReportGenerationFailed]: {
    code: PaymentErrorCode.ReportGenerationFailed,
    name: "ReportGenerationFailed",
    message: "Report generation failed: aggregation error",
  },
  [PaymentErrorCode.AnalyticsDataMissing]: {
    code: PaymentErrorCode.AnalyticsDataMissing,
    name: "AnalyticsDataMissing",
    message: "Analytics data missing: required metrics unavailable",
  },
  [PaymentErrorCode.MetricOutOfRange]: {
    code: PaymentErrorCode.MetricOutOfRange,
    name: "MetricOutOfRange",
    message: "Metric out of range: value exceeds allowed bounds",
  },
  [PaymentErrorCode.ReportTooLarge]: {
    code: PaymentErrorCode.ReportTooLarge,
    name: "ReportTooLarge",
    message: "Report too large: exceeds maximum output size",
  },
  [PaymentErrorCode.SnapshotNotFound]: {
    code: PaymentErrorCode.SnapshotNotFound,
    name: "SnapshotNotFound",
    message: "Snapshot not found: requested point-in-time state missing",
  },
  [PaymentErrorCode.AggregationWindowInvalid]: {
    code: PaymentErrorCode.AggregationWindowInvalid,
    name: "AggregationWindowInvalid",
    message: "Aggregation window invalid: time range is malformed",
  },
  [PaymentErrorCode.DataRetentionExpired]: {
    code: PaymentErrorCode.DataRetentionExpired,
    name: "DataRetentionExpired",
    message: "Data retention expired: historical data was pruned",
  },
  [PaymentErrorCode.ReportAccessDenied]: {
    code: PaymentErrorCode.ReportAccessDenied,
    name: "ReportAccessDenied",
    message: "Report access denied: insufficient permissions",
  },
  [PaymentErrorCode.AnalyticsQuotaExceeded]: {
    code: PaymentErrorCode.AnalyticsQuotaExceeded,
    name: "AnalyticsQuotaExceeded",
    message: "Analytics quota exceeded: too many report requests",
  },
  [PaymentErrorCode.ExportFormatUnsupported]: {
    code: PaymentErrorCode.ExportFormatUnsupported,
    name: "ExportFormatUnsupported",
    message: "Export format unsupported: requested format is not available",
  },
  [PaymentErrorCode.SepProtocolViolation]: {
    code: PaymentErrorCode.SepProtocolViolation,
    name: "SepProtocolViolation",
    message: "SEP protocol violation: interface contract was not honored",
  },
  [PaymentErrorCode.AssetNotSepCompliant]: {
    code: PaymentErrorCode.AssetNotSepCompliant,
    name: "AssetNotSepCompliant",
    message: "Asset not SEP-compliant: missing required SEP behavior",
  },
  [PaymentErrorCode.CrossContractVersionMismatch]: {
    code: PaymentErrorCode.CrossContractVersionMismatch,
    name: "CrossContractVersionMismatch",
    message: "Cross-contract version mismatch: incompatible API versions",
  },
  [PaymentErrorCode.InterfaceNotImplemented]: {
    code: PaymentErrorCode.InterfaceNotImplemented,
    name: "InterfaceNotImplemented",
    message: "Interface not implemented: required method is missing",
  },
  [PaymentErrorCode.StandardsComplianceFailed]: {
    code: PaymentErrorCode.StandardsComplianceFailed,
    name: "StandardsComplianceFailed",
    message: "Standards compliance failed: validation did not pass",
  },
  [PaymentErrorCode.ProtocolUpgradeRequired]: {
    code: PaymentErrorCode.ProtocolUpgradeRequired,
    name: "ProtocolUpgradeRequired",
    message: "Protocol upgrade required: dependency is out of date",
  },
  [PaymentErrorCode.InteropHandshakeFailed]: {
    code: PaymentErrorCode.InteropHandshakeFailed,
    name: "InteropHandshakeFailed",
    message: "Interop handshake failed: connection could not be established",
  },
  [PaymentErrorCode.NamespaceCollision]: {
    code: PaymentErrorCode.NamespaceCollision,
    name: "NamespaceCollision",
    message: "Namespace collision: identifier is already registered",
  },
  [PaymentErrorCode.ExternalSystemUnavailable]: {
    code: PaymentErrorCode.ExternalSystemUnavailable,
    name: "ExternalSystemUnavailable",
    message: "External system unavailable: dependency is offline",
  },
  [PaymentErrorCode.InteropRateLimitExceeded]: {
    code: PaymentErrorCode.InteropRateLimitExceeded,
    name: "InteropRateLimitExceeded",
    message: "Interop rate limit exceeded: too many cross-system calls",
  },
  [PaymentErrorCode.ContractUpgradeScheduled]: {
    code: PaymentErrorCode.ContractUpgradeScheduled,
    name: "ContractUpgradeScheduled",
    message: "Contract upgrade scheduled: upgrade is pending execution",
  },
  [PaymentErrorCode.MaintenanceModeActive]: {
    code: PaymentErrorCode.MaintenanceModeActive,
    name: "MaintenanceModeActive",
    message: "Maintenance mode active: operations temporarily disabled",
  },
  [PaymentErrorCode.CircuitBreakerTripped]: {
    code: PaymentErrorCode.CircuitBreakerTripped,
    name: "CircuitBreakerTripped",
    message: "Circuit breaker tripped: safety threshold was exceeded",
  },
  [PaymentErrorCode.EmergencyFreezeActive]: {
    code: PaymentErrorCode.EmergencyFreezeActive,
    name: "EmergencyFreezeActive",
    message: "Emergency freeze active: all state changes are blocked",
  },
  [PaymentErrorCode.SystemClockDriftDetected]: {
    code: PaymentErrorCode.SystemClockDriftDetected,
    name: "SystemClockDriftDetected",
    message: "System clock drift detected: ledger time is inconsistent",
  },
  [PaymentErrorCode.LedgerVersionUnsupported]: {
    code: PaymentErrorCode.LedgerVersionUnsupported,
    name: "LedgerVersionUnsupported",
    message: "Ledger version unsupported: network upgrade required",
  },
  [PaymentErrorCode.NetworkPartitionDetected]: {
    code: PaymentErrorCode.NetworkPartitionDetected,
    name: "NetworkPartitionDetected",
    message: "Network partition detected: consensus is unavailable",
  },
  [PaymentErrorCode.ResourceExhaustionWarning]: {
    code: PaymentErrorCode.ResourceExhaustionWarning,
    name: "ResourceExhaustionWarning",
    message: "Resource exhaustion warning: limits are near capacity",
  },
  [PaymentErrorCode.GracePeriodActive]: {
    code: PaymentErrorCode.GracePeriodActive,
    name: "GracePeriodActive",
    message: "Grace period active: transitional restrictions in effect",
  },
  [PaymentErrorCode.ConfigurationInvalid]: {
    code: PaymentErrorCode.ConfigurationInvalid,
    name: "ConfigurationInvalid",
    message: "Configuration invalid: stored configuration is malformed",
  },
  [PaymentErrorCode.SystemFatalError]: {
    code: PaymentErrorCode.SystemFatalError,
    name: "SystemFatalError",
    message: "System fatal error: unrecoverable internal failure",
  },
  [PaymentErrorCode.RevocationNotFound]: {
    code: PaymentErrorCode.RevocationNotFound,
    name: "RevocationNotFound",
    message: "Revocation not found",
  },
  [PaymentErrorCode.RevocationNotDue]: {
    code: PaymentErrorCode.RevocationNotDue,
    name: "RevocationNotDue",
    message: "Revocation not due",
  },
  [PaymentErrorCode.RevocationAlreadyExecuted]: {
    code: PaymentErrorCode.RevocationAlreadyExecuted,
    name: "RevocationAlreadyExecuted",
    message: "Revocation already executed",
  },
  [PaymentErrorCode.CannotRevokeSelf]: {
    code: PaymentErrorCode.CannotRevokeSelf,
    name: "CannotRevokeSelf",
    message: "Cannot revoke self",
  },
  [PaymentErrorCode.NoPendingOwner]: {
    code: PaymentErrorCode.NoPendingOwner,
    name: "NoPendingOwner",
    message: "No pending ownership transfer",
  },
  [PaymentErrorCode.MathOverflow]: {
    code: PaymentErrorCode.MathOverflow,
    name: "MathOverflow",
    message: "Math overflow",
  },
  [PaymentErrorCode.StreamInvariantViolated]: {
    code: PaymentErrorCode.StreamInvariantViolated,
    name: "StreamInvariantViolated",
    message: "Stream accounting invariant violated: refused to pay an inconsistent amount",
  },
  [PaymentErrorCode.InvalidPauseScope]: {
    code: PaymentErrorCode.InvalidPauseScope,
    name: "InvalidPauseScope",
    message: "Pause scope not recognized: unknown scope identifier",
  },
  [PaymentErrorCode.PaymentIdempotencyConflict]: {
    code: PaymentErrorCode.PaymentIdempotencyConflict,
    name: "PaymentIdempotencyConflict",
    message: "Idempotency key was reused for a different payment payload",
  },
};

export const PAYMENT_ERROR_NAMES: readonly PaymentErrorName[] = [
  "NotInitialized",
  "AlreadyInitialized",
  "PaymentNotFound",
  "Unauthorized",
  "InvalidAmount",
  "EscrowNotDue",
  "EscrowAlreadyReleased",
  "EscrowNotFound",
  "StreamNotStarted",
  "StreamAlreadyCancelled",
  "StreamNotFound",
  "StreamFullyClaimed",
  "BatchTooLarge",
  "BatchEmpty",
  "TokenTransferFailed",
  "InsufficientBalance",
  "PaymentAlreadyCancelled",
  "ContractPaused",
  "NoTokensToWithdraw",
  "UpgradeNotProposed",
  "UpgradeTimelockActive",
  "MultisigNotConfigured",
  "NotASigner",
  "AlreadyApproved",
  "ThresholdNotMet",
  "AlreadyExecuted",
  "NotARoleHolder",
  "AuditLogEmpty",
  "AuditEntryNotFound",
  "RecurringNotFound",
  "RecurringNotDue",
  "RecurringAlreadyCancelled",
  "RecurringExpired",
  "FeeConfigNotFound",
  "FeeTooHigh",
  "TimelockNotFound",
  "TimelockNotDue",
  "TimelockAlreadyExecuted",
  "GovernanceNotConfigured",
  "ProposalNotFound",
  "VotingPeriodEnded",
  "ProposalAlreadyExecuted",
  "QuorumNotMet",
  "ProposalDefeated",
  "DepositTooLow",
  "SpendingLimitExpired",
  "RefundNotFound",
  "RefundAlreadyProcessed",
  "PaymentAlreadyRefunded",
  "RefundWindowExpired",
  "AlreadyVoted",
  "ReentrantCall",
  "SpendCapExceeded",
  "DisputeAlreadyFiled",
  "DisputeNotFound",
  "DisputeWindowExpired",
  "RefundRejected",
  "InsufficientLiquidity",
  "AssetDepegged",
  "ProposalNotPassed",
  "InvalidSignature",
  "HookNotFound",
  "HookAlreadyExists",
  "RateLimitExceeded",
  "AssetNotSupported",
  "InvalidMetadataLength",
  "MaxRecipientsExceeded",
  "DuplicateRecipient",
  "StreamEndBeforeStart",
  "EscrowDeadlineInPast",
  "PendingOwnershipTransfer",
  "OwnershipTransferExpired",
  "InvalidAddressFormat",
  "BatchItemFailed",
  "RecurringScheduleInvalid",
  "FeeCollectorNotSet",
  "EmitterNotLinked",
  "ProposalDepositLocked",
  "MultisigSignerLimit",
  "InvalidTokenContract",
  "StorageLimitExceeded",
  "ContractMigrationRequired",
  "InvalidEventType",
  "WebhookUrlTooLong",
  "MaxHooksExceeded",
  "HookNotActive",
  "CrossContractCallFailed",
  "InvalidScValEncoding",
  "UnsupportedOperation",
  "ContractNotLinked",
  "MaxSignersExceeded",
  "ZeroAddressNotAllowed",
  "InvalidNetwork",
  "StakingNotConfigured",
  "StakingAlreadyActive",
  "RewardsPoolEmpty",
  "UnstakingPeriodActive",
  "MinimumStakeNotMet",
  "MaximumStakeExceeded",
  "RewardsAlreadyClaimed",
  "DelegationNotAllowed",
  "ValidatorNotActive",
  "SlashingConditionMet",
  "StakingPaused",
  "CompoundRewardsFailed",
  "YieldTooLow",
  "StakingPeriodNotEnded",
  "RewardDistributionFailed",
  "UnauthorizedDelegator",
  "BridgeNotConfigured",
  "BridgePaused",
  "InvalidSourceChain",
  "InvalidDestinationChain",
  "CrossChainProofInvalid",
  "BridgeRelayerNotSet",
  "BridgeAmountTooLow",
  "BridgeAmountTooHigh",
  "BridgeTransactionExpired",
  "UnsupportedTokenPair",
  "InsuranceFundNotConfigured",
  "InsuranceFundEmpty",
  "InsuranceClaimAlreadyFiled",
  "InsuranceClaimRejected",
  "InsuranceClaimWindowExpired",
  "CoverageLimitExceeded",
  "PremiumNotPaid",
  "RiskScoreTooHigh",
  "UnderwritingFailed",
  "InsurancePaused",
  "KYCNotCompleted",
  "KYCTierTooLow",
  "AMLFlagRaised",
  "SanctionsListMatch",
  "IdentityVerificationFailed",
  "TravelRuleViolation",
  "JurisdictionNotSupported",
  "ResidencyCheckFailed",
  "AccreditationRequired",
  "AgeVerificationFailed",
  "PaymentRouteNotFound",
  "PaymentSplitFailed",
  "SplitPercentageInvalid",
  "RouteHopLimitExceeded",
  "PathPaymentTooExpensive",
  "LiquidityPoolNotFound",
  "SlippageExceeded",
  "DeadlineExceeded",
  "PriceOracleStale",
  "FlashLoanNotRepaid",
  "OutOfGas",
  "GasPriceTooLow",
  "GasRefundFailed",
  "MemoryLimitExceeded",
  "StackDepthExceeded",
  "InstructionBudgetExceeded",
  "ReadBudgetExceeded",
  "WriteBudgetExceeded",
  "TTLTooLow",
  "LedgerEntryLimitReached",
  "OracleNotConfigured",
  "OracleTimeout",
  "OraclePriceDeviation",
  "DataFeedUnavailable",
  "DataFeedTampered",
  "OracleAlreadyActive",
  "PriceFeedStale",
  "ConfidenceIntervalTooWide",
  "OracleSignatureInvalid",
  "MaxPriceAgeExceeded",
  "BatchExecutionTimeout",
  "BatchPartialFailure",
  "StreamRateInvalid",
  "StreamTooLong",
  "StreamClaimTooEarly",
  "BatchAuthorizationFailed",
  "BatchDuplicateId",
  "StreamBeneficiaryUnchanged",
  "StreamTransferNotAllowed",
  "BatchCleanupFailed",
  "DisputeNotOpen",
  "DisputeArbiterNotSet",
  "DisputeEvidenceRequired",
  "DisputeAlreadyResolved",
  "DisputeResolutionTimedOut",
  "ArbiterNotAuthorized",
  "MediationFailed",
  "AppealWindowClosed",
  "DisputeBondInsufficient",
  "DisputeEscalationFailed",
  "MaxStorageEntriesReached",
  "StorageFeeNotPaid",
  "ArchiveEntryNotFound",
  "StateSyncMismatch",
  "MigrationInProgress",
  "RollbackDetected",
  "SnapshotVerificationFailed",
  "ContractDeprecated",
  "EmergencyShutdownActive",
  "SystemOverloaded",
  "DelegateNotActive",
  "DelegationExpired",
  "VoteDelegationMismatch",
  "ProposalCancelled",
  "ProposalQuorumChanged",
  "EmergencyGovernancePaused",
  "GovernanceTokenLocked",
  "VotingPowerFrozen",
  "ProposalExecutionFailed",
  "GovernanceUpgradePending",
  "TreasuryNotConfigured",
  "TreasuryWithdrawalPending",
  "ReserveRequirementNotMet",
  "TreasuryMultisigRequired",
  "ReserveAssetUnavailable",
  "TreasuryReportMismatch",
  "ReserveRatioBreached",
  "TreasuryAuditFailed",
  "ReserveRebalanceFailed",
  "TreasuryAccessRevoked",
  "TokenAlreadyListed",
  "TokenDelistingPending",
  "AssetPairNotFound",
  "TokenSupplyCapExceeded",
  "MintingPaused",
  "BurningPaused",
  "TokenFrozen",
  "AssetTrustlineMissing",
  "TokenMetadataInvalid",
  "AssetMigrationPending",
  "LendingPoolNotConfigured",
  "LoanNotFound",
  "LoanAlreadyRepaid",
  "CollateralInsufficient",
  "LiquidationPending",
  "InterestRateInvalid",
  "CreditLimitExceeded",
  "LoanMaturityReached",
  "CollateralFrozen",
  "LendingPaused",
  "SubscriptionNotFound",
  "SubscriptionAlreadyCancelled",
  "SubscriptionRenewalFailed",
  "BillingCycleInvalid",
  "SubscriptionPaused",
  "TrialPeriodExpired",
  "PaymentMethodInvalid",
  "SubscriptionTierNotAllowed",
  "UsageQuotaExceeded",
  "SubscriptionUpgradePending",
  "ZkProofInvalid",
  "PrivacyPoolNotConfigured",
  "CommitmentAlreadySpent",
  "NullifierAlreadyUsed",
  "MerklePathInvalid",
  "PrivacyDepositTooLow",
  "PrivacyWithdrawalPending",
  "StealthAddressInvalid",
  "ConfidentialTransferFailed",
  "PrivacyPaused",
  "NotificationServiceDown",
  "MessageTooLong",
  "RecipientUnsubscribed",
  "NotificationDeliveryFailed",
  "NotificationRateLimited",
  "MessageSignatureInvalid",
  "InboxFull",
  "NotificationTemplateInvalid",
  "MessageExpired",
  "NotificationChannelClosed",
  "ReportGenerationFailed",
  "AnalyticsDataMissing",
  "MetricOutOfRange",
  "ReportTooLarge",
  "SnapshotNotFound",
  "AggregationWindowInvalid",
  "DataRetentionExpired",
  "ReportAccessDenied",
  "AnalyticsQuotaExceeded",
  "ExportFormatUnsupported",
  "SepProtocolViolation",
  "AssetNotSepCompliant",
  "CrossContractVersionMismatch",
  "InterfaceNotImplemented",
  "StandardsComplianceFailed",
  "ProtocolUpgradeRequired",
  "InteropHandshakeFailed",
  "NamespaceCollision",
  "ExternalSystemUnavailable",
  "InteropRateLimitExceeded",
  "ContractUpgradeScheduled",
  "MaintenanceModeActive",
  "CircuitBreakerTripped",
  "EmergencyFreezeActive",
  "SystemClockDriftDetected",
  "LedgerVersionUnsupported",
  "NetworkPartitionDetected",
  "ResourceExhaustionWarning",
  "GracePeriodActive",
  "ConfigurationInvalid",
  "SystemFatalError",
  "RevocationNotFound",
  "RevocationNotDue",
  "RevocationAlreadyExecuted",
  "CannotRevokeSelf",
  "NoPendingOwner",
  "MathOverflow",
  "StreamInvariantViolated",
  "InvalidPauseScope",
  "PaymentIdempotencyConflict",
] as const;

export function getPaymentErrorName(code: number): PaymentErrorName | undefined {
  return PAYMENT_ERROR_DEFINITIONS[code]?.name;
}

export function getPaymentErrorMessage(code: number): string | undefined {
  return PAYMENT_ERROR_DEFINITIONS[code]?.message;
}

export function isPaymentErrorCode(code: number): code is PaymentErrorCode {
  return code in PAYMENT_ERROR_DEFINITIONS;
}
