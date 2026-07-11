#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    let _ = tessaryn_canonical::parse_strict_json_bounded(bytes, 4 * 1024 * 1024);
});
