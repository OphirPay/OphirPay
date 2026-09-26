//! Error catalog for the OphirPay contract.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum PaymentError {
    // ── Core Errors (1-10) ───────────────────────────────────
    /// Contract not initialized: call init() first
    NotInitialized = 1,
    /// Contract already initialized
    AlreadyInitialized = 2,
    /// Payment not found
    PaymentNotFound = 3,
    /// Unauthorized: caller does not have permission
    Unauthorized = 4,
    /// Invalid amount: must be greater than zero
    InvalidAmount = 5,
    /// Escrow not yet due: deadline has not passed
    EscrowNotDue = 6,
    /// Escrow already released
    EscrowAlreadyReleased = 7,
    /// Escrow not found
    EscrowNotFound = 8,
    /// Stream not started: start time is in the future
    StreamNotStarted = 9,
    /// Stream already cancelled
    StreamAlreadyCancelled = 10,
    // ── Stream + Batch Errors (11-20) ────────────────────────
    /// Stream not found
    StreamNotFound = 11,
    /// Stream fully claimed: no remaining balance
    StreamFullyClaimed = 12,
    /// Batch too large: exceeds maximum recipients
    BatchTooLarge = 13,
    /// Batch empty: no recipients provided
    BatchEmpty = 14,
    /// Token transfer failed
    TokenTransferFailed = 15,
    /// Insufficient balance to cover payment
    InsufficientBalance = 16,
    /// Payment already cancelled
    PaymentAlreadyCancelled = 17,
    /// Contract paused: operations are temporarily disabled
    ContractPaused = 18,
    /// No tokens available to withdraw
    NoTokensToWithdraw = 19,
    /// Upgrade not proposed: call propose_upgrade() first
    UpgradeNotProposed = 20,
    // ── Upgrade + Multisig Errors (21-30) ────────────────────
    /// Upgrade timelock active: 24-hour delay has not elapsed
    UpgradeTimelockActive = 21,
    /// Multisig not configured: call set_multisig_config() first
    MultisigNotConfigured = 22,
    /// Not a signer: you are not in the multisig signer list
    NotASigner = 23,
    /// Already approved: duplicate approval detected
    AlreadyApproved = 24,
    /// Threshold not met: insufficient approvals
    ThresholdNotMet = 25,
    /// Already executed: this action has already been processed
    AlreadyExecuted = 26,
    /// Not a role holder: insufficient RBAC permissions
    NotARoleHolder = 27,
    /// Audit log empty: no entries recorded
    AuditLogEmpty = 28,
    /// Audit entry not found
    AuditEntryNotFound = 29,
    /// Recurring payment not found
    RecurringNotFound = 30,
    // ── Recurring + Fee Errors (31-40) ────────────────────
    /// Recurring payment not yet due
    RecurringNotDue = 31,
    /// Recurring payment already cancelled
    RecurringAlreadyCancelled = 32,
    /// Recurring payment expired: all payments completed
    RecurringExpired = 33,
    /// Fee configuration not found
    FeeConfigNotFound = 34,
    /// Fee too high: exceeds maximum 1000 bps (10%)
    FeeTooHigh = 35,
    /// Timelocked action not found
    TimelockNotFound = 36,
    /// Timelocked action not yet due: 24-hour delay has not elapsed
    TimelockNotDue = 37,
    /// Timelocked action already executed
    TimelockAlreadyExecuted = 38,
    /// Governance not configured: call configure_governance() first
    GovernanceNotConfigured = 39,
    /// Proposal not found
    ProposalNotFound = 40,
    // ── Governance + Spend Errors (41-52) ───────────────────
    /// Voting period ended: proposal is closed
    VotingPeriodEnded = 41,
    /// Proposal already executed
    ProposalAlreadyExecuted = 42,
    /// Quorum not met: insufficient votes cast
    QuorumNotMet = 43,
    /// Proposal defeated: no votes exceeded yes votes
    ProposalDefeated = 44,
    /// Deposit too low: must meet minimum proposal deposit
    DepositTooLow = 45,
    /// Spending limit expired: limit has been deactivated or expired
    SpendingLimitExpired = 46,
    /// Refund not found
    RefundNotFound = 47,
    /// Refund already processed
    RefundAlreadyProcessed = 48,
    /// Payment already refunded
    PaymentAlreadyRefunded = 49,
    /// Refund window expired
    RefundWindowExpired = 50,
    /// Already voted: each address may vote only once per proposal
    AlreadyVoted = 51,
    /// Reentrant call detected: cross-contract reentry blocked
    ReentrantCall = 52,
    // ── Spend + Dispute Errors (53-59) ──────────────────────
    /// Spending cap exceeded: total spend exceeds authorization
    SpendCapExceeded = 53,
    /// Dispute already filed: a dispute exists for this transaction
    DisputeAlreadyFiled = 54,
    /// Dispute not found
    DisputeNotFound = 55,
    /// Dispute window expired: too late to file a dispute
    DisputeWindowExpired = 56,
    /// Refund rejected: refund request was denied
    RefundRejected = 57,
    /// Insufficient liquidity: pool cannot fulfill the order
    InsufficientLiquidity = 58,
    /// Asset depegged: stablecoin is off its target peg
    AssetDepegged = 59,
    // ── Extended Errors (60-99) ───────────────────────────────
    /// Proposal not passed: insufficient yes votes
    ProposalNotPassed = 60,
    /// Invalid signature: recovered signer does not match
    InvalidSignature = 61,
    /// Hook not found
    HookNotFound = 62,
    /// Hook already exists: duplicate hook registration
    HookAlreadyExists = 63,
    /// Rate limit exceeded: too many requests
    RateLimitExceeded = 64,
    /// Asset not supported by this contract
    AssetNotSupported = 65,
    /// Invalid metadata length: exceeds maximum allowed
    InvalidMetadataLength = 66,
    /// Maximum recipients exceeded
    MaxRecipientsExceeded = 67,
    /// Duplicate recipient in batch
    DuplicateRecipient = 68,
    /// Stream end time must be after start time
    StreamEndBeforeStart = 69,
    /// Escrow deadline must be in the future
    EscrowDeadlineInPast = 70,
    /// Pending ownership transfer: accept or cancel first
    PendingOwnershipTransfer = 71,
    /// Ownership transfer expired: timelock elapsed without acceptance
    OwnershipTransferExpired = 72,
    /// Invalid address format
    InvalidAddressFormat = 73,
    /// Batch item failed: individual payment in batch error
    BatchItemFailed = 74,
    /// Invalid recurring schedule type
    RecurringScheduleInvalid = 75,
    /// Fee collector address not set
    FeeCollectorNotSet = 76,
    /// Emitter contract not linked: call set_emitter() first
    EmitterNotLinked = 77,
    /// Proposal deposit is locked: cannot withdraw while voting
    ProposalDepositLocked = 78,
    /// Multisig signer limit exceeded
    MultisigSignerLimit = 79,
    /// Invalid token contract address
    InvalidTokenContract = 80,
    /// Storage limit exceeded: contract storage is full
    StorageLimitExceeded = 81,
    /// Contract migration required: upgrade to continue
    ContractMigrationRequired = 82,
    /// Invalid event type for notification hook
    InvalidEventType = 83,
    /// Webhook URL too long: exceeds maximum length
    WebhookUrlTooLong = 84,
    /// Maximum notification hooks exceeded
    MaxHooksExceeded = 85,
    /// Notification hook is not active
    HookNotActive = 86,
    /// Cross-contract call failed
    CrossContractCallFailed = 87,
    /// Invalid ScVal encoding in parameters
    InvalidScValEncoding = 88,
    /// Unsupported operation: not available in this version
    UnsupportedOperation = 89,
    /// Contract not linked: configure linked contract first
    ContractNotLinked = 90,
    /// Maximum signers exceeded for multisig
    MaxSignersExceeded = 91,
    /// Zero address not allowed for this operation
    ZeroAddressNotAllowed = 92,
    /// Invalid network: wrong Stellar network configured
    InvalidNetwork = 93,
    // ── Staking & Rewards (94-109) ───────────────────────────
    /// Staking not configured: call configure_staking() first
    StakingNotConfigured = 94,
    /// Staking already active: cannot modify while staking
    StakingAlreadyActive = 95,
    /// Rewards pool empty: no rewards available for distribution
    RewardsPoolEmpty = 96,
    /// Unstaking period active: funds are still in cooldown
    UnstakingPeriodActive = 97,
    /// Minimum stake not met: stake must exceed the minimum
    MinimumStakeNotMet = 98,
    /// Maximum stake exceeded: stake cannot exceed the cap
    MaximumStakeExceeded = 99,
    /// Rewards already claimed for this epoch
    RewardsAlreadyClaimed = 100,
    /// Delegation not allowed: delegator is not authorized
    DelegationNotAllowed = 101,
    /// Validator not active: selected validator is offline
    ValidatorNotActive = 102,
    /// Slashing condition met: stake is subject to penalty
    SlashingConditionMet = 103,
    /// Staking is currently paused
    StakingPaused = 104,
    /// Compound rewards failed: auto-compound error
    CompoundRewardsFailed = 105,
    /// Yield too low: below minimum acceptable rate
    YieldTooLow = 106,
    /// Staking period not ended: cannot unstake yet
    StakingPeriodNotEnded = 107,
    /// Reward distribution failed: transfer error
    RewardDistributionFailed = 108,
    /// Delegator not authorized for this validator
    UnauthorizedDelegator = 109,
    // ── Cross-Chain & Bridge (110-119) ──────────────────────
    /// Bridge not configured: call configure_bridge() first
    BridgeNotConfigured = 110,
    /// Bridge is currently paused
    BridgePaused = 111,
    /// Invalid source chain identifier
    InvalidSourceChain = 112,
    /// Invalid destination chain identifier
    InvalidDestinationChain = 113,
    /// Cross-chain proof invalid: verification failed
    CrossChainProofInvalid = 114,
    /// Bridge relayer not set: configure relayer address
    BridgeRelayerNotSet = 115,
    /// Bridge amount too low: below minimum transfer
    BridgeAmountTooLow = 116,
    /// Bridge amount too high: exceeds maximum transfer
    BridgeAmountTooHigh = 117,
    /// Bridge transaction expired: timeout reached
    BridgeTransactionExpired = 118,
    /// Unsupported token pair for bridge transfer
    UnsupportedTokenPair = 119,
    // ── Insurance & Risk (120-129) ──────────────────────────
    /// Insurance fund not configured
    InsuranceFundNotConfigured = 120,
    /// Insurance fund empty: no funds available for claims
    InsuranceFundEmpty = 121,
    /// Insurance claim already filed for this event
    InsuranceClaimAlreadyFiled = 122,
    /// Insurance claim rejected: does not meet criteria
    InsuranceClaimRejected = 123,
    /// Insurance claim window expired
    InsuranceClaimWindowExpired = 124,
    /// Coverage limit exceeded: claim exceeds policy cap
    CoverageLimitExceeded = 125,
    /// Premium not paid: insurance coverage is inactive
    PremiumNotPaid = 126,
    /// Risk score too high: coverage denied
    RiskScoreTooHigh = 127,
    /// Underwriting failed: risk assessment error
    UnderwritingFailed = 128,
    /// Insurance operations are currently paused
    InsurancePaused = 129,
    // ── Identity & Compliance (130-139) ─────────────────────
    /// KYC not completed: identity verification required
    KYCNotCompleted = 130,
    /// KYC tier too low: upgrade verification level
    KYCTierTooLow = 131,
    /// AML flag raised: transaction blocked for review
    AMLFlagRaised = 132,
    /// Sanctions list match: address is restricted
    SanctionsListMatch = 133,
    /// Identity verification failed: documents invalid
    IdentityVerificationFailed = 134,
    /// Travel rule violation: beneficiary info required
    TravelRuleViolation = 135,
    /// Jurisdiction not supported for this operation
    JurisdictionNotSupported = 136,
    /// Residency check failed: proof of residency required
    ResidencyCheckFailed = 137,
    /// Accreditation required: investor status not verified
    AccreditationRequired = 138,
    /// Age verification failed: minimum age not met
    AgeVerificationFailed = 139,
    // ── Payment Routing & Splitting (140-149) ───────────────
    /// Payment route not found: no valid path
    PaymentRouteNotFound = 140,
    /// Payment split failed: distribution error
    PaymentSplitFailed = 141,
    /// Split percentage invalid: must sum to 100%
    SplitPercentageInvalid = 142,
    /// Route hop limit exceeded: path too long
    RouteHopLimitExceeded = 143,
    /// Path payment too expensive: exceeds max fee
    PathPaymentTooExpensive = 144,
    /// Liquidity pool not found for asset pair
    LiquidityPoolNotFound = 145,
    /// Slippage exceeded: price moved beyond tolerance
    SlippageExceeded = 146,
    /// Deadline exceeded: transaction too old
    DeadlineExceeded = 147,
    /// Price oracle stale: last update too old
    PriceOracleStale = 148,
    /// Flash loan not repaid in same transaction
    FlashLoanNotRepaid = 149,
    // ── Gas & Resource Management (150-159) ─────────────────
    /// Out of gas: computation budget exhausted
    OutOfGas = 150,
    /// Gas price too low: below network minimum
    GasPriceTooLow = 151,
    /// Gas refund failed: refund transfer error
    GasRefundFailed = 152,
    /// Memory limit exceeded: allocation too large
    MemoryLimitExceeded = 153,
    /// Stack depth exceeded: too many nested calls
    StackDepthExceeded = 154,
    /// Instruction budget exceeded: too many operations
    InstructionBudgetExceeded = 155,
    /// Read budget exceeded: too many storage reads
    ReadBudgetExceeded = 156,
    /// Write budget exceeded: too many storage writes
    WriteBudgetExceeded = 157,
    /// TTL too low: entry would expire too soon
    TTLTooLow = 158,
    /// Ledger entry limit reached: cannot create more
    LedgerEntryLimitReached = 159,
    // ── Oracle & Data Feeds (160-169) ───────────────────────
    /// Oracle not configured: call set_oracle() first
    OracleNotConfigured = 160,
    /// Oracle timeout: response took too long
    OracleTimeout = 161,
    /// Oracle price deviation: outlier detected
    OraclePriceDeviation = 162,
    /// Data feed unavailable: source is offline
    DataFeedUnavailable = 163,
    /// Data feed tampered: integrity check failed
    DataFeedTampered = 164,
    /// Oracle already active: duplicate registration
    OracleAlreadyActive = 165,
    /// Price feed stale: last update exceeds threshold
    PriceFeedStale = 166,
    /// Confidence interval too wide: price uncertain
    ConfidenceIntervalTooWide = 167,
    /// Oracle signature invalid: attestation failed
    OracleSignatureInvalid = 168,
    /// Maximum price age exceeded: feed too old
    MaxPriceAgeExceeded = 169,
    // ── Batch & Streaming Advanced (170-179) ────────────────
    /// Batch execution timeout: not all items finished
    BatchExecutionTimeout = 170,
    /// Batch partial failure: some items failed
    BatchPartialFailure = 171,
    /// Stream rate invalid: must be positive non-zero
    StreamRateInvalid = 172,
    /// Stream duration too long: exceeds maximum
    StreamTooLong = 173,
    /// Stream claim too early: minimum interval not met
    StreamClaimTooEarly = 174,
    /// Batch authorization failed: signer rejected
    BatchAuthorizationFailed = 175,
    /// Batch duplicate ID: transaction already processed
    BatchDuplicateId = 176,
    /// Stream beneficiary unchanged: same as current
    StreamBeneficiaryUnchanged = 177,
    /// Stream transfer not allowed: stream is non-transferable
    StreamTransferNotAllowed = 178,
    /// Batch cleanup failed: stale state removal error
    BatchCleanupFailed = 179,
    // ── Dispute Resolution (180-189) ────────────────────────
    /// Dispute not open: no active dispute found
    DisputeNotOpen = 180,
    /// Dispute arbiter not set: configure arbiter first
    DisputeArbiterNotSet = 181,
    /// Dispute evidence required: must submit proof
    DisputeEvidenceRequired = 182,
    /// Dispute already resolved: final decision made
    DisputeAlreadyResolved = 183,
    /// Dispute resolution timed out: arbiter did not respond
    DisputeResolutionTimedOut = 184,
    /// Arbiter not authorized: not in approved list
    ArbiterNotAuthorized = 185,
    /// Mediation failed: parties could not agree
    MediationFailed = 186,
    /// Appeal window closed: too late to appeal
    AppealWindowClosed = 187,
    /// Dispute bond insufficient: must stake more
    DisputeBondInsufficient = 188,
    /// Dispute escalation failed: higher authority error
    DisputeEscalationFailed = 189,
    // ── Miscellaneous Guards (190-199) ──────────────────────
    /// Maximum storage entries reached: ledger full
    MaxStorageEntriesReached = 190,
    /// Storage fee not paid: rent payment required
    StorageFeeNotPaid = 191,
    /// Archive entry not found: record already pruned
    ArchiveEntryNotFound = 192,
    /// State sync mismatch: ledger state inconsistent
    StateSyncMismatch = 193,
    /// Migration in progress: try again later
    MigrationInProgress = 194,
    /// Rollback detected: chain reorganization
    RollbackDetected = 195,
    /// Snapshot verification failed: hash mismatch
    SnapshotVerificationFailed = 196,
    /// Contract deprecated: use the new version
    ContractDeprecated = 197,
    /// Emergency shutdown active: all operations blocked
    EmergencyShutdownActive = 198,
    /// System overloaded: too many concurrent requests
    SystemOverloaded = 199,
    // ── Advanced Governance (200-209) ───────────────────────
    /// Delegate not active: delegator is offline or disabled
    DelegateNotActive = 200,
    /// Delegation expired: delegation period has ended
    DelegationExpired = 201,
    /// Vote delegation mismatch: delegate does not match voter
    VoteDelegationMismatch = 202,
    /// Proposal cancelled: proposal was withdrawn by creator
    ProposalCancelled = 203,
    /// Proposal quorum changed: quorum was modified mid-vote
    ProposalQuorumChanged = 204,
    /// Emergency governance paused: voting is temporarily suspended
    EmergencyGovernancePaused = 205,
    /// Governance token locked: tokens are in a lockup period
    GovernanceTokenLocked = 206,
    /// Voting power frozen: votes are immobilized by a freeze
    VotingPowerFrozen = 207,
    /// Proposal execution failed: on-chain execution reverted
    ProposalExecutionFailed = 208,
    /// Governance upgrade pending: upgrade has not been finalized
    GovernanceUpgradePending = 209,
    // ── Treasury & Reserves (210-219) ───────────────────────
    /// Treasury not configured: call configure_treasury() first
    TreasuryNotConfigured = 210,
    /// Treasury withdrawal pending: timelock has not elapsed
    TreasuryWithdrawalPending = 211,
    /// Reserve requirement not met: minimum reserve ratio breached
    ReserveRequirementNotMet = 212,
    /// Treasury multisig required: threshold signatures missing
    TreasuryMultisigRequired = 213,
    /// Reserve asset unavailable: asset cannot be used as reserve
    ReserveAssetUnavailable = 214,
    /// Treasury report mismatch: balance does not match ledger
    TreasuryReportMismatch = 215,
    /// Reserve ratio breached: reserves fell below the minimum
    ReserveRatioBreached = 216,
    /// Treasury audit failed: reconciliation check did not pass
    TreasuryAuditFailed = 217,
    /// Reserve rebalance failed: allocation update reverted
    ReserveRebalanceFailed = 218,
    /// Treasury access revoked: caller permissions were removed
    TreasuryAccessRevoked = 219,
    // ── Token & Asset Management (220-229) ──────────────────
    /// Token already listed: asset is already supported
    TokenAlreadyListed = 220,
    /// Token delisting pending: removal is awaiting timelock
    TokenDelistingPending = 221,
    /// Asset pair not found: no market exists for the pair
    AssetPairNotFound = 222,
    /// Token supply cap exceeded: mint would exceed the cap
    TokenSupplyCapExceeded = 223,
    /// Minting paused: new issuance is temporarily disabled
    MintingPaused = 224,
    /// Burning paused: token destruction is temporarily disabled
    BurningPaused = 225,
    /// Token frozen: asset transfers are blocked
    TokenFrozen = 226,
    /// Asset trustline missing: trustline must be established
    AssetTrustlineMissing = 227,
    /// Token metadata invalid: name, symbol, or decimals malformed
    TokenMetadataInvalid = 228,
    /// Asset migration pending: upgrade to new contract incomplete
    AssetMigrationPending = 229,
    // ── Lending & Credit (230-239) ──────────────────────────
    /// Lending pool not configured: call configure_lending() first
    LendingPoolNotConfigured = 230,
    /// Loan not found
    LoanNotFound = 231,
    /// Loan already repaid: no outstanding balance
    LoanAlreadyRepaid = 232,
    /// Collateral insufficient: below required ratio
    CollateralInsufficient = 233,
    /// Liquidation pending: position is in the process of liquidation
    LiquidationPending = 234,
    /// Interest rate invalid: outside allowed bounds
    InterestRateInvalid = 235,
    /// Credit limit exceeded: borrow would exceed the limit
    CreditLimitExceeded = 236,
    /// Loan maturity reached: repayment is now due
    LoanMaturityReached = 237,
    /// Collateral frozen: collateral cannot be moved
    CollateralFrozen = 238,
    /// Lending paused: borrow and lend operations are suspended
    LendingPaused = 239,
    // ── Recurring & Subscriptions (240-249) ─────────────────
    /// Subscription not found
    SubscriptionNotFound = 240,
    /// Subscription already cancelled
    SubscriptionAlreadyCancelled = 241,
    /// Subscription renewal failed: payment did not settle
    SubscriptionRenewalFailed = 242,
    /// Billing cycle invalid: interval is not supported
    BillingCycleInvalid = 243,
    /// Subscription paused: renewals are temporarily halted
    SubscriptionPaused = 244,
    /// Trial period expired: paid plan is now required
    TrialPeriodExpired = 245,
    /// Payment method invalid: token or method not accepted
    PaymentMethodInvalid = 246,
    /// Subscription tier not allowed: upgrade is restricted
    SubscriptionTierNotAllowed = 247,
    /// Usage quota exceeded: plan allowance has been reached
    UsageQuotaExceeded = 248,
    /// Subscription upgrade pending: change has not been applied
    SubscriptionUpgradePending = 249,
    // ── Privacy & Zero-Knowledge (250-259) ──────────────────
    /// Zero-knowledge proof invalid: verification failed
    ZkProofInvalid = 250,
    /// Privacy pool not configured: call configure_privacy() first
    PrivacyPoolNotConfigured = 251,
    /// Commitment already spent: double-spend detected
    CommitmentAlreadySpent = 252,
    /// Nullifier already used: proof was previously consumed
    NullifierAlreadyUsed = 253,
    /// Merkle path invalid: membership proof is malformed
    MerklePathInvalid = 254,
    /// Privacy deposit too low: below the minimum amount
    PrivacyDepositTooLow = 255,
    /// Privacy withdrawal pending: timelock has not elapsed
    PrivacyWithdrawalPending = 256,
    /// Stealth address invalid: cannot derive recipient
    StealthAddressInvalid = 257,
    /// Confidential transfer failed: shielded amount mismatch
    ConfidentialTransferFailed = 258,
    /// Privacy paused: shielded operations are suspended
    PrivacyPaused = 259,
    // ── Messaging & Notifications (260-269) ─────────────────
    /// Notification service down: delivery backend unavailable
    NotificationServiceDown = 260,
    /// Message too long: exceeds maximum length
    MessageTooLong = 261,
    /// Recipient unsubscribed: target has opted out
    RecipientUnsubscribed = 262,
    /// Notification delivery failed: could not reach recipient
    NotificationDeliveryFailed = 263,
    /// Notification rate limited: too many messages sent
    NotificationRateLimited = 264,
    /// Message signature invalid: sender could not be verified
    MessageSignatureInvalid = 265,
    /// Inbox full: recipient storage limit reached
    InboxFull = 266,
    /// Notification template invalid: malformed payload
    NotificationTemplateInvalid = 267,
    /// Message expired: delivery window has passed
    MessageExpired = 268,
    /// Notification channel closed: channel is no longer active
    NotificationChannelClosed = 269,
    // ── Analytics & Reporting (270-279) ─────────────────────
    /// Report generation failed: aggregation error
    ReportGenerationFailed = 270,
    /// Analytics data missing: required metrics unavailable
    AnalyticsDataMissing = 271,
    /// Metric out of range: value exceeds allowed bounds
    MetricOutOfRange = 272,
    /// Report too large: exceeds maximum output size
    ReportTooLarge = 273,
    /// Snapshot not found: requested point-in-time state missing
    SnapshotNotFound = 274,
    /// Aggregation window invalid: time range is malformed
    AggregationWindowInvalid = 275,
    /// Data retention expired: historical data was pruned
    DataRetentionExpired = 276,
    /// Report access denied: insufficient permissions
    ReportAccessDenied = 277,
    /// Analytics quota exceeded: too many report requests
    AnalyticsQuotaExceeded = 278,
    /// Export format unsupported: requested format is not available
    ExportFormatUnsupported = 279,
    // ── Interoperability & Standards (280-289) ──────────────
    /// SEP protocol violation: interface contract was not honored
    SepProtocolViolation = 280,
    /// Asset not SEP-compliant: missing required SEP behavior
    AssetNotSepCompliant = 281,
    /// Cross-contract version mismatch: incompatible API versions
    CrossContractVersionMismatch = 282,
    /// Interface not implemented: required method is missing
    InterfaceNotImplemented = 283,
    /// Standards compliance failed: validation did not pass
    StandardsComplianceFailed = 284,
    /// Protocol upgrade required: dependency is out of date
    ProtocolUpgradeRequired = 285,
    /// Interop handshake failed: connection could not be established
    InteropHandshakeFailed = 286,
    /// Namespace collision: identifier is already registered
    NamespaceCollision = 287,
    /// External system unavailable: dependency is offline
    ExternalSystemUnavailable = 288,
    /// Interop rate limit exceeded: too many cross-system calls
    InteropRateLimitExceeded = 289,
    // ── System & Protocol Guards (290-300) ──────────────────
    /// Contract upgrade scheduled: upgrade is pending execution
    ContractUpgradeScheduled = 290,
    /// Maintenance mode active: operations temporarily disabled
    MaintenanceModeActive = 291,
    /// Circuit breaker tripped: safety threshold was exceeded
    CircuitBreakerTripped = 292,
    /// Emergency freeze active: all state changes are blocked
    EmergencyFreezeActive = 293,
    /// System clock drift detected: ledger time is inconsistent
    SystemClockDriftDetected = 294,
    /// Ledger version unsupported: network upgrade required
    LedgerVersionUnsupported = 295,
    /// Network partition detected: consensus is unavailable
    NetworkPartitionDetected = 296,
    /// Resource exhaustion warning: limits are near capacity
    ResourceExhaustionWarning = 297,
    /// Grace period active: transitional restrictions in effect
    GracePeriodActive = 298,
    /// Configuration invalid: stored configuration is malformed
    ConfigurationInvalid = 299,
    /// System fatal error: unrecoverable internal failure
    SystemFatalError = 300,
    // ── Two-Step Revocation (301-305) ──────────────────────
    /// Revocation not found
    RevocationNotFound = 301,
    /// Revocation not due
    RevocationNotDue = 302,
    /// Revocation already executed
    RevocationAlreadyExecuted = 303,
    /// Cannot revoke self
    CannotRevokeSelf = 304,
    /// No pending ownership transfer
    NoPendingOwner = 305,
    /// Math overflow
    MathOverflow = 306,
    // ── Stream Accounting Guards (307) ─────────────────────
    /// Stream accounting invariant violated: refused to pay an inconsistent amount
    StreamInvariantViolated = 307,
    // ── Scoped Pause (308) ──────────────────────────────
    /// Pause scope not recognized: unknown scope identifier
    InvalidPauseScope = 308,
}
