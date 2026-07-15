#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "tessaryn")]
extern "C" {
    #[link_name = "random_fill"]
    fn imported_random_fill(pointer: *mut u8, length: usize) -> i32;
}

#[cfg(target_arch = "wasm32")]
fn browser_getrandom(output: &mut [u8]) -> Result<(), getrandom::Error> {
    let status = unsafe { imported_random_fill(output.as_mut_ptr(), output.len()) };
    if status == 0 {
        Ok(())
    } else {
        Err(getrandom::Error::UNSUPPORTED)
    }
}

#[cfg(target_arch = "wasm32")]
getrandom::register_custom_getrandom!(browser_getrandom);
