use super::*;

fn schedule(saved: &str, intervals: &[u32], time: &str, zone: &str) -> Vec<ScheduledReview> {
    let settings = ReviewSettings::new(intervals.to_vec(), time, zone).unwrap();
    calculate_reviews(saved.parse().unwrap(), &settings).unwrap()
}

fn utc_times(reviews: &[ScheduledReview]) -> Vec<String> {
    reviews
        .iter()
        .map(|r| r.scheduled_for.with_timezone(&Utc).to_rfc3339())
        .collect()
}

#[test]
fn defaults_are_offsets_from_the_original_local_save_date() {
    // UTC Dec 31 is already Jan 1 in Hong Kong; offsets are not chained together.
    let reviews = schedule(
        "2025-12-31T18:00:00Z",
        &DEFAULT_INTERVALS,
        "09:15",
        "Asia/Hong_Kong",
    );
    assert_eq!(
        reviews.iter().map(|r| r.after_days).collect::<Vec<_>>(),
        vec![3, 7, 30]
    );
    assert_eq!(
        utc_times(&reviews),
        vec![
            "2026-01-04T01:15:00+00:00",
            "2026-01-08T01:15:00+00:00",
            "2026-01-31T01:15:00+00:00",
        ]
    );
}

#[test]
fn western_timezone_uses_the_previous_local_date() {
    let reviews = schedule("2026-01-01T01:00:00Z", &[1], "23:59", "America/Los_Angeles");
    assert_eq!(utc_times(&reviews), vec!["2026-01-02T07:59:00+00:00"]);
}

#[test]
fn calendar_arithmetic_crosses_leap_days_months_and_years() {
    for (saved, days, expected) in [
        ("2024-02-28T23:59:00Z", 1, "2024-02-29T00:00:00+00:00"),
        ("2024-02-28T23:59:00Z", 2, "2024-03-01T00:00:00+00:00"),
        ("2025-02-28T23:59:00Z", 1, "2025-03-01T00:00:00+00:00"),
        ("2025-12-31T23:59:00Z", 1, "2026-01-01T00:00:00+00:00"),
    ] {
        assert_eq!(
            utc_times(&schedule(saved, &[days], "00:00", "UTC")),
            vec![expected]
        );
    }
}

#[test]
fn spring_gap_uses_first_valid_instant_without_shifting_later_reviews() {
    let reviews = schedule("2026-03-07T17:00:00Z", &[1, 2], "02:30", "America/New_York");
    assert_eq!(
        utc_times(&reviews),
        vec!["2026-03-08T07:00:00+00:00", "2026-03-09T06:30:00+00:00"]
    );
    assert_eq!(
        reviews[0].scheduled_for.format("%H:%M").to_string(),
        "03:00"
    );
}

#[test]
fn autumn_overlap_uses_the_earlier_occurrence() {
    let reviews = schedule("2026-10-31T16:00:00Z", &[1, 2], "01:30", "America/New_York");
    assert_eq!(
        utc_times(&reviews),
        vec!["2026-11-01T05:30:00+00:00", "2026-11-02T06:30:00+00:00"]
    );
}

#[test]
fn a_calendar_day_is_not_always_twenty_four_hours() {
    for (saved, expected) in [
        ("2026-03-07T14:00:00Z", "2026-03-08T13:00:00+00:00"),
        ("2026-10-31T13:00:00Z", "2026-11-01T14:00:00+00:00"),
    ] {
        assert_eq!(
            utc_times(&schedule(saved, &[1], "09:00", "America/New_York")),
            vec![expected]
        );
    }
}

#[test]
fn half_hour_gap_and_skipped_date_follow_the_same_policy() {
    let half_hour = schedule("2026-10-03T00:00:00Z", &[1], "02:15", "Australia/Lord_Howe");
    assert_eq!(utc_times(&half_hour), vec!["2026-10-03T15:30:00+00:00"]);
    assert_eq!(
        half_hour[0].scheduled_for.format("%H:%M").to_string(),
        "02:30"
    );
    let skipped = schedule("2011-12-29T12:00:00Z", &[1], "09:00", "Pacific/Apia");
    assert_eq!(
        skipped[0]
            .scheduled_for
            .format("%Y-%m-%d %H:%M")
            .to_string(),
        "2011-12-31 00:00"
    );
}

#[test]
fn invalid_settings_are_rejected_instead_of_normalized_silently() {
    for intervals in [vec![], vec![0], vec![3, 3], vec![7, 3]] {
        assert!(ReviewSettings::new(intervals, "09:00", "UTC").is_err());
    }
    for time in [
        "", "9:00", "09:0", "24:00", "09:60", "09:00:00", " 09:00", "９:00",
    ] {
        assert!(ReviewSettings::new(vec![1], time, "UTC").is_err(), "{time}");
    }
    for zone in ["", "local", "+08:00", "Not/AZone"] {
        assert!(
            ReviewSettings::new(vec![1], "09:00", zone).is_err(),
            "{zone}"
        );
    }
}

#[test]
fn unsupported_dates_return_errors_without_panicking_or_partial_results() {
    let settings = ReviewSettings::new(vec![1, u32::MAX], "09:00", "UTC").unwrap();
    assert!(calculate_reviews("2026-01-01T00:00:00Z".parse().unwrap(), &settings).is_err());
    for (anchor, zone) in [
        (DateTime::<Utc>::MAX_UTC, "Asia/Tokyo"),
        (DateTime::<Utc>::MIN_UTC, "America/New_York"),
    ] {
        let settings = ReviewSettings::new(vec![1], "09:00", zone).unwrap();
        assert!(calculate_reviews(anchor, &settings).is_err());
    }
}

#[test]
fn skipped_dates_preserve_distinct_review_intervals_even_when_instants_coincide() {
    let reviews = schedule("2011-12-29T12:00:00Z", &[1, 2], "00:00", "Pacific/Apia");
    assert_eq!(reviews.len(), 2);
    assert_eq!(reviews[0].after_days, 1);
    assert_eq!(reviews[1].after_days, 2);
    assert_eq!(reviews[0].scheduled_for, reviews[1].scheduled_for);
}
