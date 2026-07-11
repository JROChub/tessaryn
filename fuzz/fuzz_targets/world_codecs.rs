#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    let _ = tessaryn_forge::decode_surfel_chunk(bytes);
    let _ = tessaryn_reconstruct::decode_sdf_chunk(bytes);
});
