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
    /// seconds since 1970: when it was made (undated reminders are shown newest first), or when it was finished
    pub at: Option<f64>,
}

/// "granted", "denied", "ask" (never asked) or "unavailable" (not on this device)
#[derive(Serialize, Clone, Debug, Default)]
pub struct Day {
    pub calendar: String,
    pub reminders: String,
    pub events: Vec<Event>,
    /// open reminders due by the end of the day (overdue too), soonest first
    pub todo: Vec<Reminder>,
    /// open reminders with no due date, newest first
    pub undated: Vec<Reminder>,
    /// how many open reminders have no due date in all (undated holds at most 12)
    pub undated_total: usize,
    /// reminders finished between from and to (only when asked for, for a page about yesterday)
    pub done: Vec<Reminder>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::{sel, ClassType};
    use objc2_event_kit::{EKAlarm, EKAuthorizationStatus, EKEntityType, EKEvent, EKEventStore, EKReminder, EKSpan};
    use objc2_foundation::{NSArray, NSCalendar, NSCalendarUnit, NSDate, NSError, NSString};
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

    fn fetch(store: &EKEventStore, pred: &objc2_foundation::NSPredicate, finished: bool) -> Vec<Reminder> {
        let (tx, rx) = mpsc::channel::<Vec<Reminder>>();
        unsafe {
            let done = RcBlock::new(move |found: *mut NSArray<EKReminder>| unsafe {
                let mut out = Vec::new();
                if let Some(found) = found.as_ref() {
                    let cal = NSCalendar::currentCalendar();
                    for r in found.iter() {
                        let due = r.dueDateComponents().and_then(|c| cal.dateFromComponents(&c)).map(|d| d.timeIntervalSince1970());
                        let at = if finished { r.completionDate() } else { r.creationDate() }.map(|d| d.timeIntervalSince1970());
                        out.push(Reminder {
                            id: ns(&r.calendarItemIdentifier()),
                            title: ns(&r.title()),
                            due,
                            list: r.calendar().map(|c| ns(&c.title())).unwrap_or_default(),
                            priority: r.priority() as u64,
                            at,
                        });
                    }
                }
                let _ = tx.send(out);
            });
            let _ = store.fetchRemindersMatchingPredicate_completion(pred, &done);
        }
        rx.recv_timeout(Duration::from_secs(20)).unwrap_or_default()
    }

    /// Every open reminder, split into the ones due by `to` (overdue too; soonest first) and the ones with no
    /// due date (newest first). Reminders due after today are left out. (Asking Reminders for "due before the
    /// end of today" leaves out every reminder without a date, so this asks for all open ones and sorts here.)
    fn open_reminders(store: &EKEventStore, to: f64) -> (Vec<Reminder>, Vec<Reminder>, usize) {
        let pred = unsafe { store.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(None, None, None) };
        let all = fetch(store, &pred, false);
        let (mut dated, mut undated): (Vec<Reminder>, Vec<Reminder>) = all.into_iter().partition(|r| r.due.is_some());
        dated.retain(|r| r.due.unwrap_or(f64::MAX) < to);
        dated.sort_by(|a, b| a.due.unwrap_or(f64::MAX).partial_cmp(&b.due.unwrap_or(f64::MAX)).unwrap_or(std::cmp::Ordering::Equal));
        dated.truncate(12);
        let total = undated.len();
        undated.sort_by(|a, b| b.at.unwrap_or(0.0).partial_cmp(&a.at.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
        undated.truncate(12);
        (dated, undated, total)
    }

    /// Reminders finished between `from` and `to`, in the order they were finished.
    fn finished(store: &EKEventStore, from: f64, to: f64) -> Vec<Reminder> {
        let pred = unsafe {
            let start = NSDate::dateWithTimeIntervalSince1970(from);
            let end = NSDate::dateWithTimeIntervalSince1970(to);
            store.predicateForCompletedRemindersWithCompletionDateStarting_ending_calendars(Some(&start), Some(&end), None)
        };
        let mut out = fetch(store, &pred, true);
        out.sort_by(|a, b| a.at.unwrap_or(0.0).partial_cmp(&b.at.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
        out.truncate(20);
        out
    }

    /// Today's events and reminders. With `ask`, the system prompt is shown for whatever hasn't been answered yet.
    pub fn today(from: f64, to: f64, want_cal: bool, want_rem: bool, ask: bool, want_done: bool) -> Day {
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
            let (todo, undated, total) = open_reminders(&store, to);
            day.todo = todo;
            day.undated = undated;
            day.undated_total = total;
            if want_done {
                day.done = finished(&store, from, to);
            }
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

    /// Add a new reminder to the default Reminders list (quick capture on My Day). With `due` (seconds since 1970)
    /// it gets a due date; `timed` adds the time of day and an alert then, otherwise it's due that day.
    pub fn add(title: &str, due: Option<f64>, timed: bool) -> Result<String, String> {
        if status(EKEntityType::Reminder) != "granted" {
            return Err("Allow Reminders first (My Day › Your day › Allow).".into());
        }
        unsafe {
            let store = EKEventStore::new();
            let cal = store.defaultCalendarForNewReminders().ok_or("Reminders has no default list to add to.")?;
            let r = EKReminder::reminderWithEventStore(&store);
            r.setTitle(Some(&NSString::from_str(title.trim())));
            r.setCalendar(Some(&cal));
            if let Some(t) = due {
                let date = NSDate::dateWithTimeIntervalSince1970(t);
                let mut units = NSCalendarUnit::Year | NSCalendarUnit::Month | NSCalendarUnit::Day;
                if timed {
                    units = units | NSCalendarUnit::Hour | NSCalendarUnit::Minute;
                }
                let parts = NSCalendar::currentCalendar().components_fromDate(units, &date);
                r.setDueDateComponents(Some(&parts));
                if timed {
                    r.addAlarm(&EKAlarm::alarmWithAbsoluteDate(&date));
                }
            }
            store.saveReminder_commit_error(&r, true).map_err(|e| format!("Reminders didn't save that ({}).", e.localizedDescription()))?;
            Ok(ns(&r.calendarItemIdentifier()))
        }
    }

    /// Add an event to the default calendar. `start` and `end` are seconds since 1970.
    pub fn add_event(title: &str, start: f64, end: f64, all_day: bool) -> Result<String, String> {
        if status(EKEntityType::Event) != "granted" {
            return Err("Allow Calendar first (My Day › Your day › Allow).".into());
        }
        unsafe {
            let store = EKEventStore::new();
            let cal = store.defaultCalendarForNewEvents().ok_or("Calendar has no default calendar to add to.")?;
            let e = EKEvent::eventWithEventStore(&store);
            e.setTitle(Some(&NSString::from_str(title.trim())));
            e.setStartDate(Some(&NSDate::dateWithTimeIntervalSince1970(start)));
            e.setEndDate(Some(&NSDate::dateWithTimeIntervalSince1970(end.max(start + 60.0))));
            e.setAllDay(all_day);
            e.setCalendar(Some(&cal));
            store
                .saveEvent_span_commit_error(&e, EKSpan::ThisEvent, true)
                .map_err(|err| format!("Calendar didn't save that ({}).", err.localizedDescription()))?;
            Ok(e.eventIdentifier().map(|i| ns(&i)).unwrap_or_default())
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub use apple::{add, add_event, set_done, today};

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn today(_from: f64, _to: f64, want_cal: bool, want_rem: bool, _ask: bool, _want_done: bool) -> Day {
    let off = |w: bool| if w { "unavailable" } else { "off" }.to_string();
    Day { calendar: off(want_cal), reminders: off(want_rem), ..Default::default() }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn set_done(_id: &str, _done: bool) -> Result<(), String> {
    Err("Reminders are only on Apple devices.".into())
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn add(_title: &str, _due: Option<f64>, _timed: bool) -> Result<String, String> {
    Err("Reminders are only on Apple devices.".into())
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn add_event(_title: &str, _start: f64, _end: f64, _all_day: bool) -> Result<String, String> {
    Err("Calendar is only on Apple devices.".into())
}
