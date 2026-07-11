#![no_main]

use libfuzzer_sys::fuzz_target;
use tessaryn_sync::{decode_sync_packet, verify_sync_packet, SyncPacketV0};
use tessaryn_witness::{decode_witness_receipt, verify_receipt, WitnessReceiptV0};

fuzz_target!(|bytes: &[u8]| {
    if bytes.len() > 4 * 1024 * 1024 {
        return;
    }
    let _ = decode_sync_packet(bytes);
    let _ = decode_witness_receipt(bytes, 0);
    if let Ok(packet) = serde_json::from_slice::<SyncPacketV0>(bytes) {
        let _ = verify_sync_packet(&packet);
    }
    if let Ok(receipt) = serde_json::from_slice::<WitnessReceiptV0>(bytes) {
        let _ = verify_receipt(&receipt, 0);
    }
});
