// Home Screen widgets: the latest stories waiting in Today, and your reading streak.
// The app leaves a short summary in the shared keychain each time it updates; the widgets read it.
import SwiftUI
import WidgetKit

struct Story: Codable, Hashable {
    let t: String
    let f: String
    let p: Bool?
}

struct Snapshot: Codable {
    let unread: Int
    let stories: [Story]
    let streak: Int?
    let books: Int?
    let goal: Int?

    static let sample = Snapshot(unread: 12, stories: [
        Story(t: "Most of the internet isn’t human anymore", f: "David Daniels", p: true),
        Story(t: "Why I still write HTML by hand", f: "handmade.website", p: true),
        Story(t: "The indie web is having a moment again", f: "The Verge", p: false),
    ], streak: 6, books: 3, goal: 15)

    static func load() -> Snapshot? {
        SharedStore.read("widget").flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snap: Snapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snap: .sample) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, snap: context.isPreview ? (Snapshot.load() ?? .sample) : Snapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now, snap: Snapshot.load())], policy: .after(.now.addingTimeInterval(20 * 60))))
    }
}

extension Color {
    static let rrGreen = Color(red: 0.18, green: 0.70, blue: 0.55)
}

struct Masthead: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "dot.radiowaves.up.forward").font(.system(size: 11, weight: .semibold))
            Text("The Reading Room").font(.system(size: 12, weight: .semibold, design: .serif))
        }
        .foregroundStyle(Color.rrGreen)
    }
}

struct LatestView: View {
    @Environment(\.widgetFamily) var family
    let snap: Snapshot?

    var body: some View {
        if let snap {
            let n = family == .systemSmall ? 1 : family == .systemMedium ? 3 : 6
            VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 8) {
                HStack(alignment: .firstTextBaseline) {
                    Masthead()
                    Spacer(minLength: 4)
                    if family != .systemSmall { Text("\(snap.unread) new today").font(.caption2).foregroundStyle(.secondary) }
                }
                if family == .systemSmall {
                    Text("\(snap.unread)").font(.system(size: 34, weight: .semibold, design: .serif))
                    Text(snap.unread == 1 ? "new story today" : "new stories today").font(.caption2).foregroundStyle(.secondary)
                }
                if snap.stories.isEmpty {
                    Text("You’re caught up.").font(.system(.subheadline, design: .serif)).foregroundStyle(.secondary)
                }
                ForEach(snap.stories.prefix(n), id: \.self) { s in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.t).font(.system(family == .systemSmall ? .caption : .subheadline, design: .serif)).fontWeight(.medium).lineLimit(2)
                        if family != .systemSmall { Text(s.f).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Masthead()
                Text("Open The Reading Room once to fill this in.").font(.system(.subheadline, design: .serif)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

struct StreakView: View {
    let snap: Snapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Masthead()
            Spacer(minLength: 0)
            if let s = snap, let streak = s.streak {
                Text("\(streak)").font(.system(size: 40, weight: .semibold, design: .serif)).foregroundStyle(Color.rrGreen)
                Text(streak == 1 ? "day in a row" : "days in a row").font(.caption).foregroundStyle(.secondary)
                if let g = s.goal { Text("\(g) minutes a day").font(.caption2).foregroundStyle(.secondary) }
            } else if let s = snap {
                Text("\(s.books ?? 0)").font(.system(size: 40, weight: .semibold, design: .serif)).foregroundStyle(Color.rrGreen)
                Text((s.books ?? 0) == 1 ? "book this year" : "books this year").font(.caption).foregroundStyle(.secondary)
                Text("Set a reading goal to see your streak.").font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            } else {
                Text("Open The Reading Room once to fill this in.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct LatestWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "latest", provider: Provider()) { e in
            LatestView(snap: e.snap).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Latest stories")
        .description("What’s new today from the people you read.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct StreakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "streak", provider: Provider()) { e in
            StreakView(snap: e.snap).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Reading streak")
        .description("Days in a row you’ve met your reading goal.")
        .supportedFamilies([.systemSmall])
    }
}

@main
struct ReadingRoomWidgets: WidgetBundle {
    var body: some Widget {
        LatestWidget()
        StreakWidget()
    }
}
