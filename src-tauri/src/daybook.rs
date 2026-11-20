//! Today's calendar and reminders for the Today page, read from the Calendar and Reminders data already on
//! this Mac, iPhone or iPad (EventKit). Nothing is sent anywhere: the app reads them here and shows them.
//! The first time, the system asks the person's OK (once for Calendar, once for Reminders).

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct Event {
    pub id: String,
    pub title: String,
    /// seconds since 1970 (UTC)
    pub start: f64,
    pub end: f64,
    pub all_day: bool,
    pub location: String,
    pub calendar: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Reminder {
    pub id: String,
    pub title: String,
    /// seconds since 1970, or none when the reminder has no due date
    pub due: Option<f64>,
    pub list: String,
    pub priority: u64,
}

/// "granted", "denied", "ask" (never asked) or "unavailable" (not on this device)
#[derive(Serialize, Clone, Debug, Default)]
pub struct Day {
    pub calendar: String,
    pub reminders: String,
    pub events: Vec<Event>,
    pub todo: Vec<Reminder>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::{sel, ClassType};
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore, EKReminder};
    use objc2_foundation::{NSArray, NSCalendar, NSDate, NSError, NSString};
    use std::sync::mpsc;
    use std::time::Duration;

    fn status(kind: EKEntityType) -> &'static str {
        let s = unsafe { EKEventStore::authorizationStatusForEntityType(kind) };
        if s == EKAuthorizationStatus::FullAccess {
            "granted"
        } else if s == EKAuthorizationStatus::NotDetermined {
            "ask"
        } else {
            "denied"
        }
    }

    /// Ask the system for full access (shows the OK prompt the first time). Waits up to two minutes for the answer.
    fn request(store: &EKEventStore, kind: EKEntityType) -> bool {
        let (tx, rx) = mpsc::channel::<bool>();
        let done = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        let ptr = &*done as *const _ as *mut _;
        unsafe {
            let cls = EKEventStore::class();
            if kind == EKEntityType::Event && cls.responds_to(sel!(requestFullAccessToEventsWithCompletion:)) {
                store.requestFullAccessToEventsWithCompletion(ptr);
            } else if kind == EKEntityType::Reminder && cls.responds_to(sel!(requestFullAccessToRemindersWithCompletion:)) {
                store.requestFullAccessToRemindersWithCompletion(ptr);
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(kind, ptr);
            }
        }
        rx.recv_timeout(Duration::from_secs(120)).unwrap_or(false)
    }

    fn ns(s: &NSString) -> String {
        s.to_string()
    }

    fn events(store: &EKEventStore, from: f64, to: f64) -> Vec<Event> {
        unsafe {
            let start = NSDate::dateWithTimeIntervalSince1970(from);
            let end = NSDate::dateWithTimeIntervalSince1970(to);
            let pred = store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
            let found: Retained<NSArray<objc2_event_kit::EKEvent>> = store.eventsMatchingPredicate(&pred);
            let mut out: Vec<Event> = found
                .iter()
                .map(|e| Event {
                    id: ns(&e.calendarItemIdentifier()),
                    title: ns(&e.title()),
                    start: e.startDate().timeIntervalSince1970(),
                    end: e.endDate().timeIntervalSince1970(),
                    all_day: e.isAllDay(),
                    location: e.location().map(|l| ns(&l)).unwrap_or_default(),
                    calendar: e.calendar().map(|c| ns(&c.title())).unwrap_or_default(),
                })
                .collect();
            out.sort_by(|a, b| (!a.all_day).cmp(&!b.all_day).then(a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal)));
            out.truncate(12);
            out
        }
    }

    /// Reminders not done yet that are due by the end of today (overdue ones too), soonest first.
    fn reminders(store: &EKEventStore, to: f64) -> Vec<Reminder> {
        let (tx, rx) = mpsc::channel::<Vec<Reminder>>();
        unsafe {
            let end = NSDate::dateWithTimeIntervalSince1970(to);
            let pred = store.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(None, Some(&end), None);
            let done = RcBlock::new(move |found: *mut NSArray<EKReminder>| unsafe {
                let mut out = Vec::new();
                if let Some(found) = found.as_ref() {
                    let cal = NSCalendar::currentCalendar();
                    for r in found.iter() {
                        let due = r.dueDateComponents().and_then(|c| cal.dateFromComponents(&c)).map(|d| d.timeIntervalSince1970());
                        out.push(Reminder {
                            id: ns(&r.calendarItemIdentifier()),
                            title: ns(&r.title()),
                            due,
                            list: r.calendar().map(|c| ns(&c.title())).unwrap_or_default(),
                            priority: r.priority() as u64,
                        });
                    }
                }
                let _ = tx.send(out);
            });
            let _ = store.fetchRemindersMatchingPredicate_completion(&pred, &done);
        }
        let mut out = rx.recv_timeout(Duration::from_secs(20)).unwrap_or_default();
        out.sort_by(|a, b| a.due.unwrap_or(f64::MAX).partial_cmp(&b.due.unwrap_or(f64::MAX)).unwrap_or(std::cmp::Ordering::Equal));
        out.truncate(12);
        out
    }

    /// Today's events and reminders. With `ask`, the system prompt is shown for whatever hasn't been answered yet.
    pub fn today(from: f64, to: f64, want_cal: bool, want_rem: bool, ask: bool) -> Day {
        let store = unsafe { EKEventStore::new() };
        let mut day = Day { calendar: "off".into(), reminders: "off".into(), ..Default::default() };
        if want_cal {
            let mut s = status(EKEntityType::Event);
            if s == "ask" && ask {
                s = if request(&store, EKEntityType::Event) { "granted" } else { "denied" };
            }
            day.calendar = s.into();
        }
        if want_rem {
            let mut s = status(EKEntityType::Reminder);
            if s == "ask" && ask {
                s = if request(&store, EKEntityType::Reminder) { "granted" } else { "denied" };
            }
            day.reminders = s.into();
        }
        // a store made before access was granted doesn't see the calendars: start a fresh one
        let store = unsafe { EKEventStore::new() };
        if day.calendar == "granted" {
            day.events = events(&store, from, to);
        }
        if day.reminders == "granted" {
            day.todo = reminders(&store, to);
        }
        day
    }

    /// Tick a reminder off (or back on), in Reminders itself.
    pub fn set_done(id: &str, done: bool) -> Result<(), String> {
        unsafe {
            let store = EKEventStore::new();
            let item = store
                .calendarItemWithIdentifier(&NSString::from_str(id))
                .ok_or("That reminder isn't in Reminders anymore.")?;
            let r: Retained<EKReminder> = item.downcast::<EKReminder>().map_err(|_| "That isn't a reminder.".to_string())?;
            r.setCompleted(done);
            store.saveReminder_commit_error(&r, true).map_err(|e| format!("Reminders didn't save that ({}).", e.localizedDescription()))
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub use apple::{set_done, today};

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn today(_from: f64, _to: f64, want_cal: bool, want_rem: bool, _ask: bool) -> Day {
    let off = |w: bool| if w { "unavailable" } else { "off" }.to_string();
    Day { calendar: off(want_cal), reminders: off(want_rem), ..Default::default() }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn set_done(_id: &str, _done: bool) -> Result<(), String> {
    Err("Reminders are only on Apple devices.".into())
}
