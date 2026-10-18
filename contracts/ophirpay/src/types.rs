#[contracttype]
#[derive(Clone)]
pub struct Escrow {
    // Existing fields...
    pub dispute_initiated_at: Option<u64>,
    pub dispute_approvals: Vec<Address>,
}
