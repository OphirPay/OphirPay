# SPDX-License-Identifier: MIT
# contracts/Makefile — Automation for Soroban contract compilation and optimization

.PHONY: all build optimize test audit clean check-size

all: build optimize

build:
	@bash ../scripts/build-contracts.sh

optimize:
	@bash ../scripts/build-contracts.sh

test:
	cargo test --manifest-path ophirpay/Cargo.toml
	cargo test --manifest-path emitter/Cargo.toml

audit:
	cargo audit -f ophirpay/Cargo.lock
	cargo audit -f emitter/Cargo.lock

clean:
	cargo clean --manifest-path ophirpay/Cargo.toml
	cargo clean --manifest-path emitter/Cargo.toml
	rm -rf ../target/
