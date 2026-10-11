fn main() {
    // OpenSSL's static library (SQLCipher's crypto, ADR 0010) names a debug-symbol file it doesn't
    // ship; the linker's "PDB not found" warning (LNK4099) about it is noise.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/IGNORE:4099");
    }
}
