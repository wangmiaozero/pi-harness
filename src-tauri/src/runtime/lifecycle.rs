//! Crash-loop and event-sequence helpers. Pure so they can be tested
//! without spawning the Node sidecar.

use std::time::{Duration, Instant};

/// 5 minutes, 3 unexpected exits → `Failed`. Manual `restart` clears it.
pub const CRASH_LOOP_WINDOW: Duration = Duration::from_secs(5 * 60);
pub const CRASH_LOOP_LIMIT: usize = 3;

#[derive(Debug, Default)]
pub struct CrashLoopDetector {
    crashes: Vec<Instant>,
}

impl CrashLoopDetector {
    pub fn reset(&mut self) {
        self.crashes.clear();
    }

    /// Record an unexpected exit. Returns true when the loop threshold is hit.
    pub fn record(&mut self, now: Instant) -> bool {
        self.crashes
            .retain(|at| now.saturating_duration_since(*at) < CRASH_LOOP_WINDOW);
        self.crashes.push(now);
        self.crashes.len() >= CRASH_LOOP_LIMIT
    }
}

/// Track monotonic event sequences. A gap is diagnostic only — never fatal.
pub fn note_sequence(previous: Option<u64>, next: Option<u64>) -> (Option<u64>, bool) {
    match (previous, next) {
        (Some(prev), Some(current)) if current > prev.saturating_add(1) => (Some(current), true),
        (_, Some(current)) => (Some(current), false),
        (prev, None) => (prev, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_loop_trips_on_third_exit_inside_the_window() {
        let mut detector = CrashLoopDetector::default();
        let now = Instant::now();
        assert!(!detector.record(now));
        assert!(!detector.record(now));
        assert!(detector.record(now));
    }

    #[test]
    fn crash_loop_resets_on_manual_restart() {
        let mut detector = CrashLoopDetector::default();
        let now = Instant::now();
        detector.record(now);
        detector.record(now);
        detector.reset();
        assert!(!detector.record(now));
    }

    #[test]
    fn sequence_gap_is_reported_without_rewinding() {
        let (next, gap) = note_sequence(Some(103), Some(105));
        assert_eq!(next, Some(105));
        assert!(gap);
        let (next, gap) = note_sequence(Some(105), Some(106));
        assert_eq!(next, Some(106));
        assert!(!gap);
        let (next, gap) = note_sequence(Some(106), None);
        assert_eq!(next, Some(106));
        assert!(!gap);
    }
}
