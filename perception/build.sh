#!/bin/sh
# perception.wasm を作り直して、サイトのルートに置く。
#   準備: rustup target add wasm32-unknown-unknown
set -eu
cd "$(dirname "$0")"
cargo test --release
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/perception.wasm ../perception.wasm
ls -l ../perception.wasm
