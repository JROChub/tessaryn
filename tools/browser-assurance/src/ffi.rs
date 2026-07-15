use std::slice;
use std::sync::Mutex;

use crate::proof::{create_seal, verify_seal};

static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static ERROR: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn set_result(value: Result<Vec<u8>, String>) -> i32 {
    match value {
        Ok(bytes) => {
            *RESULT.lock().expect("result mutex poisoned") = bytes;
            ERROR.lock().expect("error mutex poisoned").clear();
            0
        }
        Err(message) => {
            RESULT.lock().expect("result mutex poisoned").clear();
            *ERROR.lock().expect("error mutex poisoned") = message.into_bytes();
            -1
        }
    }
}

unsafe fn input<'a>(pointer: *const u8, length: usize) -> Result<&'a [u8], String> {
    if pointer.is_null() && length != 0 {
        return Err("null browser-assurance input pointer".to_string());
    }
    Ok(unsafe { slice::from_raw_parts(pointer, length) })
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_alloc(length: usize) -> *mut u8 {
    let mut buffer = vec![0_u8; length];
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Releases a buffer previously returned by [`tessaryn_assurance_alloc`].
///
/// # Safety
///
/// `pointer` must be the exact pointer returned by `tessaryn_assurance_alloc`,
/// and `length` must equal the allocation length supplied to that call. The
/// buffer must not be accessed after this function returns.
#[no_mangle]
pub unsafe extern "C" fn tessaryn_assurance_dealloc(pointer: *mut u8, length: usize) {
    if !pointer.is_null() {
        drop(unsafe { Vec::from_raw_parts(pointer, length, length) });
    }
}

/// Seals canonical World Cell bytes and writes the JSON seal to the result buffer.
///
/// # Safety
///
/// Every non-null input pointer must remain readable for its corresponding
/// length for the duration of this call. The regions must contain canonical Cell
/// bytes, UTF-8 evidence JSON, and an exact 32-byte seed respectively.
#[no_mangle]
pub unsafe extern "C" fn tessaryn_assurance_seal(
    cell_pointer: *const u8,
    cell_length: usize,
    evidence_pointer: *const u8,
    evidence_length: usize,
    seed_pointer: *const u8,
    seed_length: usize,
) -> i32 {
    set_result((|| {
        let cell = unsafe { input(cell_pointer, cell_length) }?;
        let evidence = unsafe { input(evidence_pointer, evidence_length) }?;
        let seed = unsafe { input(seed_pointer, seed_length) }?;
        let seal = create_seal(cell, evidence, seed)?;
        serde_json::to_vec(&seal).map_err(|error| error.to_string())
    })())
}

/// Verifies a canonical World Cell, its evidence, and a browser assurance seal.
///
/// # Safety
///
/// Every non-null input pointer must remain readable for its corresponding
/// length for the duration of this call. Evidence and seal regions must contain
/// UTF-8 JSON.
#[no_mangle]
pub unsafe extern "C" fn tessaryn_assurance_verify(
    cell_pointer: *const u8,
    cell_length: usize,
    evidence_pointer: *const u8,
    evidence_length: usize,
    seal_pointer: *const u8,
    seal_length: usize,
) -> i32 {
    match (|| {
        verify_seal(
            unsafe { input(cell_pointer, cell_length) }?,
            unsafe { input(evidence_pointer, evidence_length) }?,
            unsafe { input(seal_pointer, seal_length) }?,
        )?;
        Ok::<(), String>(())
    })() {
        Ok(()) => {
            ERROR.lock().expect("error mutex poisoned").clear();
            1
        }
        Err(message) => {
            *ERROR.lock().expect("error mutex poisoned") = message.into_bytes();
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_result_pointer() -> *const u8 {
    RESULT.lock().expect("result mutex poisoned").as_ptr()
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_result_length() -> usize {
    RESULT.lock().expect("result mutex poisoned").len()
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_error_pointer() -> *const u8 {
    ERROR.lock().expect("error mutex poisoned").as_ptr()
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_error_length() -> usize {
    ERROR.lock().expect("error mutex poisoned").len()
}
