//! Pure review-date calculation; callers persist the first nonempty save as the anchor.
//! This module never reads the clock, editor, settings file, or calendar service.
use chrono::{DateTime, Days, LocalResult, NaiveTime, Offset, TimeDelta, TimeZone, Utc};
use chrono_tz::{GapInfo, Tz};

pub const DEFAULT_INTERVALS: [u32; 3] = [3, 7, 30];

#[derive(Debug, Clone)]
pub struct ReviewSettings {
    intervals: Vec<u32>,
    alert_time: NaiveTime,
    timezone: Tz,
}

impl ReviewSettings {
    /// Intervals are positive, strictly increasing offsets from the original save date.
    /// Require an explicit IANA timezone and a 24-hour HH:MM time, never host defaults.
    pub fn new(
        intervals: Vec<u32>,
        alert_time: &str,
        timezone: &str,
    ) -> Result<Self, &'static str> {
        if intervals.is_empty()
            || intervals.contains(&0)
            || intervals.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err("Review intervals must be positive, unique, and increasing.");
        }
        let bytes = alert_time.as_bytes();
        if bytes.len() != 5
            || bytes[2] != b':'
            || ![bytes[0], bytes[1], bytes[3], bytes[4]]
                .iter()
                .all(u8::is_ascii_digit)
        {
            return Err("Alert time must use HH:MM in 24-hour format.");
        }
        let alert_time = NaiveTime::parse_from_str(alert_time, "%H:%M")
            .map_err(|_| "Alert time must use HH:MM in 24-hour format.")?;
        let timezone = timezone
            .parse::<Tz>()
            .map_err(|_| "Unknown IANA timezone.")?;
        Ok(Self {
            intervals,
            alert_time,
            timezone,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledReview {
    pub after_days: u32,
    /// Includes the resolved UTC offset and named timezone for calendar integration.
    pub scheduled_for: DateTime<Tz>,
}

/// Compute once from the first nonempty save, not from an edit or last-review timestamp.
/// Each interval adds calendar days in the configured timezone, never 24-hour durations.
/// Gaps resolve to the first valid instant afterward; overlaps choose the earlier instant.
/// Errors return no partial schedule, including when a date exceeds Chrono's range.
pub fn calculate_reviews(
    first_saved_at: DateTime<Utc>,
    settings: &ReviewSettings,
) -> Result<Vec<ScheduledReview>, &'static str> {
    let offset = settings
        .timezone
        .offset_from_utc_datetime(&first_saved_at.naive_utc());
    // DateTime::naive_local can panic at the date limits, so convert with checked arithmetic.
    let local_save = first_saved_at
        .naive_utc()
        .checked_add_signed(TimeDelta::seconds(i64::from(
            offset.fix().local_minus_utc(),
        )))
        .ok_or("Save date is outside the supported local date range.")?;
    settings
        .intervals
        .iter()
        .map(|&after_days| {
            let date = local_save
                .date()
                .checked_add_days(Days::new(u64::from(after_days)))
                .ok_or("Review date is outside the supported date range.")?;
            let local_alert = date.and_time(settings.alert_time);
            let scheduled_for = match settings.timezone.from_local_datetime(&local_alert) {
                LocalResult::Single(time) => time,
                LocalResult::Ambiguous(first, second) => first.min(second),
                LocalResult::None => GapInfo::new(&local_alert, &settings.timezone)
                    .and_then(|gap| gap.end)
                    .ok_or("Cannot resolve the review time in this timezone.")?,
            };
            Ok(ScheduledReview {
                after_days,
                scheduled_for,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
