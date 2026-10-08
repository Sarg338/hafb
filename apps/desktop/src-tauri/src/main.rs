// Release builds are GUI-subsystem apps: no console window behind the main window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hafb_lib::run();
}
