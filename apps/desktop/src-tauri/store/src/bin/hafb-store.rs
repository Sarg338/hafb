//! `hafb-store`: plan files from the command line (dev tool for `pnpm import:ynab` and tests).
//!
//!   hafb-store create <file> [--force]   RowChanges JSON on stdin -> new plan file
//!   hafb-store load <file>               LoadedTables JSON on stdout
//!   hafb-store apply <file>              RowChanges JSON on stdin, one transaction
//!   hafb-store migrate <file>            upgrade in place (pre-migration copy saved beside it)
//!
//! With `HAFB_PLAN_PASSWORD` set (an environment variable, so it stays out of the process list),
//! `create` makes a locked plan and the others open one (S8.3b).
//!
//! Exit code 0 on success; on failure prints `{"kind":…,"message":…}` to stderr and exits 1.

use hafb_store::error::{Result, StoreError};
use hafb_store::wire::RowChanges;
use hafb_store::{OpenOptions, Password, Plan};
use std::io::{Read, Write};
use std::path::Path;
use std::process::ExitCode;

const USAGE: &str = "usage: hafb-store <create [--force] | load | apply | migrate> <file.hafb>";

fn read_changes() -> Result<RowChanges> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(serde_json::from_str(&input)?)
}

fn run(args: &[String]) -> Result<()> {
    let force = args.iter().any(|a| a == "--force");
    let rest: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let (Some(command), Some(file)) = (rest.first(), rest.get(1)) else {
        return Err(StoreError::invalid(USAGE));
    };
    let path = Path::new(file.as_str());
    let password = std::env::var("HAFB_PLAN_PASSWORD").ok().filter(|p| !p.is_empty()).map(Password::new).transpose()?;
    let options = OpenOptions { password: password.clone(), ..OpenOptions::default() };
    match command.as_str() {
        "create" => {
            match &password {
                Some(p) => Plan::create_locked(path, &read_changes()?, force, p)?,
                None => Plan::create(path, &read_changes()?, force)?,
            }
            let (plan, report) = Plan::open(path, &options)?;
            eprintln!("created {} ({})", path.display(), plan.info(&report)?.name);
        }
        "load" => {
            let (plan, _) = Plan::open(path, &options)?;
            let mut out = std::io::stdout().lock();
            serde_json::to_writer(&mut out, &plan.load()?)?;
            out.flush()?;
        }
        "apply" => {
            let changes = read_changes()?;
            let (mut plan, _) = Plan::open(path, &options)?;
            plan.apply(&changes, None)?;
        }
        "migrate" => {
            let (plan, report) = Plan::open(path, &options)?;
            match report.migrated_from {
                Some(from) => eprintln!(
                    "migrated v{from} -> v{}{}",
                    plan.schema_version()?,
                    report.pre_migration_backup_path.map(|p| format!("; copy saved to {p}")).unwrap_or_default()
                ),
                None => eprintln!("already at v{}", plan.schema_version()?),
            }
        }
        _ => return Err(StoreError::invalid(USAGE)),
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{}", serde_json::to_string(&e).unwrap_or_else(|_| e.to_string()));
            ExitCode::FAILURE
        }
    }
}
