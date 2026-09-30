// SPDX-License-Identifier: MIT

pub const fn is_spending_limit_expired(expires_at: u64, now: u64) -> bool {
    expires_at != 0 && now >= expires_at
}
