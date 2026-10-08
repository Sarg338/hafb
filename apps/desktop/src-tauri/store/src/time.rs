//! UTC timestamps for backup file names, without a date crate.

use std::time::{SystemTime, UNIX_EPOCH};

/// `YYYYMMDD-HHMMSS-mmmZ` (UTC): sorts chronologically as text, safe in a Windows file name.
pub fn file_stamp(now: SystemTime) -> String {
    let since = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let millis = since.subsec_millis();
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}-{millis:03}Z",
        rem / 3600,
        (rem / 60) % 60,
        rem % 60
    )
}

/// Days since 1970-01-01 -> (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, u32::try_from(m).unwrap_or(1), u32::try_from(d).unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_known_instants() {
        assert_eq!(file_stamp(UNIX_EPOCH), "19700101-000000-000Z");
        // 2026-10-08T12:34:56.789Z
        let t = UNIX_EPOCH + Duration::from_millis(1_791_462_896_789);
        assert_eq!(file_stamp(t), "20261008-123456-789Z");
        // Leap day 2024-02-29T23:59:59Z
        let t = UNIX_EPOCH + Duration::from_secs(1_709_251_199);
        assert_eq!(file_stamp(t), "20240229-235959-000Z");
    }
}
