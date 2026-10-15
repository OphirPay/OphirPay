#[contracterror]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum PaymentError {
    // ... existing variants
    DisputeCoolingOffActive = 101,
}
